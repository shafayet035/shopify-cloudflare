import { createForOrder, GRANT_MAX_DOWNLOADS } from "./index";
import { getEmailProvider } from "../../shared/email/provider";
import { downloadEmail } from "../../shared/email/templates";
import type { Env } from "../../types";

/** The slice of the orders/paid webhook payload this job reads. */
interface OrderPaidPayload {
	id: number;
	name: string; // "#1001"
	email?: string;
	contact_email?: string;
	line_items?: {
		product_id: number | null;
		title: string;
	}[];
}

/**
 * The flagship example flow: paid order -> download grants -> delivery email.
 * Grant creation is idempotent inside the module; this job only decides
 * whether an email is owed — when this run created grants, or when we're
 * retrying (a previous attempt may have created them and then failed to send).
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

	const { links, insertedNew, expiresAt } = await createForOrder(env, shop, {
		orderId: String(order.id),
		email,
		productIds,
	});
	if (links.length === 0 || !expiresAt) return;
	if (!insertedNew && attempt === 1) return; // already granted AND already emailed

	const message = downloadEmail({
		shopName: shop.replace(".myshopify.com", ""),
		orderName: order.name ?? String(order.id),
		links,
		expiresAt, // the stored expiry, not re-derived — retries can't drift
		maxDownloads: GRANT_MAX_DOWNLOADS,
	});
	await getEmailProvider(env).send({ to: email, ...message });
}
