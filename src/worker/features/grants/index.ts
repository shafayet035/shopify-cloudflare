/**
 * The Grant module: a buyer's right to download purchased files.
 *
 * Interface:
 *   createForOrder(env, shop, order) -> { links, insertedNew }
 *   redeem(env, token)               -> Redemption (redirect | stream | denied)
 *
 * Everything else — the grant rows, idempotency, the atomic download counter
 * (DownloadGate, an internal seam), expiry, and the presign-vs-stream delivery
 * choice — is implementation. The counter has ONE writer: redeem() bumps D1
 * after the gate admits a download; the gate's expiry alarm reconciles the
 * final count (see DownloadGate.ts).
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../shared/db/client";
import { assets, downloadGrants, productAssets } from "../../shared/db/schema";
import { presignConfigured, presignDownloadUrl } from "../../shared/r2";
import type { Env } from "../../types";

export const GRANT_TTL_DAYS = 30;
export const GRANT_MAX_DOWNLOADS = 5;

export interface GrantedLink {
	filename: string;
	url: string;
}

export interface OrderForGrants {
	orderId: string;
	email: string;
	productIds: string[];
}

/**
 * Create download grants for a paid order. Idempotent — the unique index on
 * (order_id, asset_id) plus onConflictDoNothing means a redelivered or retried
 * job never double-grants. Returns ALL of the order's links (existing + new)
 * so a retry after a partial failure can still deliver the complete list, and
 * `insertedNew` so the caller can decide whether an email is owed.
 */
export async function createForOrder(
	env: Env,
	shop: string,
	order: OrderForGrants,
): Promise<{ links: GrantedLink[]; insertedNew: boolean }> {
	const d = db(env.DB);
	if (order.productIds.length === 0) return { links: [], insertedNew: false };

	// Which uploaded assets are linked to the purchased products?
	const links = await d
		.select({ assetId: productAssets.assetId })
		.from(productAssets)
		.where(
			and(
				eq(productAssets.shopDomain, shop),
				inArray(productAssets.productId, order.productIds),
			),
		);
	if (links.length === 0) return { links: [], insertedNew: false };

	const expiresAt = new Date(Date.now() + GRANT_TTL_DAYS * 24 * 60 * 60 * 1000);
	let insertedNew = false;

	for (const link of links) {
		const inserted = await d
			.insert(downloadGrants)
			.values({
				token: crypto.randomUUID(),
				shopDomain: shop,
				orderId: order.orderId,
				orderEmail: order.email,
				assetId: link.assetId,
				maxDownloads: GRANT_MAX_DOWNLOADS,
				expiresAt,
			})
			.onConflictDoNothing()
			.returning();
		if (inserted.length > 0) insertedNew = true;
	}

	const orderGrants = await d
		.select({ token: downloadGrants.token, filename: assets.filename })
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(and(eq(downloadGrants.shopDomain, shop), eq(downloadGrants.orderId, order.orderId)));

	return {
		links: orderGrants.map((g) => ({
			filename: g.filename,
			url: `${env.SHOPIFY_APP_URL}/download/${g.token}`,
		})),
		insertedNew,
	};
}

export type Redemption =
	| { kind: "redirect"; url: string }
	| {
			kind: "stream";
			body: ReadableStream;
			filename: string;
			contentType: string;
			size: number;
			etag: string;
	  }
	| { kind: "denied"; reason: "not_found" | "expired" | "limit_reached" };

/**
 * Redeem a download token. Checks the grant, atomically spends one download
 * via the DownloadGate, and picks the delivery mechanism: a 302 to a
 * short-lived presigned R2 URL when the R2_* secrets are configured, otherwise
 * a stream through the Worker (zero extra setup, fine for smaller files).
 */
export async function redeem(env: Env, token: string): Promise<Redemption> {
	const [grant] = await db(env.DB)
		.select({
			maxDownloads: downloadGrants.maxDownloads,
			expiresAt: downloadGrants.expiresAt,
			r2Key: assets.r2Key,
			filename: assets.filename,
			contentType: assets.contentType,
		})
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(eq(downloadGrants.token, token));
	if (!grant) return { kind: "denied", reason: "not_found" };

	// Single-threaded per grant: two simultaneous requests for the last
	// remaining download can never both pass.
	const gate = env.DOWNLOAD_GATE.get(env.DOWNLOAD_GATE.idFromName(token));
	const decision = await gate.authorize({
		token,
		maxDownloads: grant.maxDownloads,
		expiresAtMs: grant.expiresAt.getTime(),
	});
	if (!decision.ok) return { kind: "denied", reason: decision.reason };

	// The one live writer of the admin-facing count.
	await db(env.DB)
		.update(downloadGrants)
		.set({ downloadsUsed: sql`${downloadGrants.downloadsUsed} + 1` })
		.where(eq(downloadGrants.token, token));

	if (presignConfigured(env)) {
		return { kind: "redirect", url: await presignDownloadUrl(env, grant.r2Key, grant.filename) };
	}

	const object = await env.ASSETS_BUCKET.get(grant.r2Key);
	if (!object) return { kind: "denied", reason: "not_found" };
	return {
		kind: "stream",
		body: object.body,
		filename: grant.filename,
		contentType: grant.contentType,
		size: object.size,
		etag: object.httpEtag,
	};
}
