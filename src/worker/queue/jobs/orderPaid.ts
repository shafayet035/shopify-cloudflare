import { and, eq, inArray } from "drizzle-orm";
import { db, getShop } from "../../db/client";
import { assets, downloadGrants, productAssets } from "../../db/schema";
import { getEmailProvider } from "../../email/provider";
import { downloadEmail } from "../../email/templates";
import type { Env } from "../../types";

const GRANT_TTL_DAYS = 30;
const GRANT_MAX_DOWNLOADS = 5;

/** The slice of the orders/paid webhook payload this job reads. */
interface OrderPaidPayload {
	id: number;
	name: string; // "#1001"
	email?: string;
	contact_email?: string;
	line_items?: {
		product_id: number | null;
		variant_id: number | null;
		title: string;
	}[];
}

/**
 * The flagship example flow: paid order -> download grants -> delivery email.
 * Idempotent by design — the unique index on (order_id, asset_id) plus
 * onConflictDoNothing means a redelivered or retried job never double-grants
 * or double-emails.
 */
export async function handleOrderPaid(
	env: Env,
	shop: string,
	payload: unknown,
	attempt = 1,
): Promise<void> {
	const order = payload as OrderPaidPayload;
	const email = order.email ?? order.contact_email;
	if (!email || !order.line_items?.length) return;

	const productIds = [
		...new Set(
			order.line_items
				.map((li) => li.product_id)
				.filter((id): id is number => id !== null)
				.map(String),
		),
	];
	if (productIds.length === 0) return;

	const d = db(env.DB);

	// Which uploaded assets are linked to the purchased products?
	const links = await d
		.select({
			assetId: productAssets.assetId,
			filename: assets.filename,
		})
		.from(productAssets)
		.innerJoin(assets, eq(productAssets.assetId, assets.id))
		.where(
			and(
				eq(productAssets.shopDomain, shop),
				inArray(productAssets.productId, productIds),
			),
		);
	if (links.length === 0) return;

	const expiresAt = new Date(Date.now() + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000);
	let insertedNew = false;

	for (const link of links) {
		const inserted = await d
			.insert(downloadGrants)
			.values({
				token: crypto.randomUUID(),
				shopDomain: shop,
				orderId: String(order.id),
				orderEmail: email,
				assetId: link.assetId,
				maxDownloads: GRANT_MAX_DOWNLOADS,
				expiresAt,
			})
			.onConflictDoNothing()
			.returning();
		if (inserted.length > 0) insertedNew = true;
	}

	// Send the email when this run created grants, or when we're retrying (a
	// previous attempt may have created the grants and then failed to send —
	// without this, that email would be lost forever). Duplicate-webhook
	// deliveries never reach this job (deduped by webhook id upstream).
	if (!insertedNew && attempt === 1) return;

	// Email links for ALL of this order's grants, not just newly inserted ones,
	// so a retry after a partial failure still delivers the complete list.
	const orderGrants = await d
		.select({ token: downloadGrants.token, filename: assets.filename })
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(and(eq(downloadGrants.shopDomain, shop), eq(downloadGrants.orderId, String(order.id))));
	const granted = orderGrants.map((g) => ({
		filename: g.filename,
		url: `${env.SHOPIFY_APP_URL}/download/${g.token}`,
	}));
	if (granted.length === 0) return;

	const shopRow = await getShop(env.DB, shop);
	const message = downloadEmail({
		shopName: shopRow ? shop.replace(".myshopify.com", "") : shop,
		orderName: order.name ?? String(order.id),
		links: granted,
		expiresAt,
		maxDownloads: GRANT_MAX_DOWNLOADS,
	});
	await getEmailProvider(env).send({ to: email, ...message });
}
