/**
 * The Grant module: a buyer's right to download purchased files.
 *
 * Primary interface:
 *   createForOrder(env, shop, order) -> { links, insertedNew, expiresAt }
 *   redeem(env, token)               -> Redemption (redirect | stream | denied)
 * Admin/cascade interface:
 *   listForShop(env, shop)           -> grant summaries for the dashboard
 *   statsForShop(env, shop)          -> { grantCount, totalDownloads }
 *   removeForAsset(env, assetId)     -> called by the assets module's cascade
 *   removeAllForShop(env, shop)      -> called by shop/redact
 *
 * Everything else — the grant rows, idempotency, the atomic download counter
 * (DownloadGate, an internal seam), expiry, and the presign-vs-stream delivery
 * choice — is implementation. The counter has ONE writer: redeem() bumps D1
 * after the gate admits a download; the gate's expiry alarm reconciles the
 * final count (see DownloadGate.ts).
 */
import { and, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
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
 * so a retry after a partial failure can still deliver the complete list,
 * `insertedNew` so the caller can decide whether an email is owed, and the
 * stored `expiresAt` so callers never re-derive (and drift from) the expiry.
 */
export async function createForOrder(
	env: Env,
	shop: string,
	order: OrderForGrants,
): Promise<{ links: GrantedLink[]; insertedNew: boolean; expiresAt: Date | null }> {
	const d = db(env.DB);
	const none = { links: [], insertedNew: false, expiresAt: null };
	if (order.productIds.length === 0) return none;

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
	if (links.length === 0) return none;

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
		.select({
			token: downloadGrants.token,
			filename: assets.filename,
			expiresAt: downloadGrants.expiresAt,
		})
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(and(eq(downloadGrants.shopDomain, shop), eq(downloadGrants.orderId, order.orderId)));
	if (orderGrants.length === 0) return none;

	return {
		links: orderGrants.map((g) => ({
			filename: g.filename,
			url: `${env.SHOPIFY_APP_URL}/download/${g.token}`,
		})),
		insertedNew,
		expiresAt: orderGrants[0].expiresAt,
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
	| { kind: "denied"; reason: "not_found" | "expired" | "limit_reached" | "file_missing" };

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
	if (!object) return { kind: "denied", reason: "file_missing" };
	return {
		kind: "stream",
		body: object.body,
		filename: grant.filename,
		contentType: grant.contentType,
		size: object.size,
		etag: object.httpEtag,
	};
}

/** Grant summaries for the admin dashboard (most recent first). */
export function listForShop(env: Env, shop: string) {
	return db(env.DB)
		.select({
			token: downloadGrants.token,
			orderId: downloadGrants.orderId,
			orderEmail: downloadGrants.orderEmail,
			filename: assets.filename,
			maxDownloads: downloadGrants.maxDownloads,
			downloadsUsed: downloadGrants.downloadsUsed,
			expiresAt: downloadGrants.expiresAt,
			createdAt: downloadGrants.createdAt,
		})
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(eq(downloadGrants.shopDomain, shop))
		.orderBy(desc(downloadGrants.createdAt))
		.limit(50);
}

export async function statsForShop(
	env: Env,
	shop: string,
): Promise<{ grantCount: number; totalDownloads: number }> {
	const [row] = await db(env.DB)
		.select({ n: count(), downloads: sum(downloadGrants.downloadsUsed) })
		.from(downloadGrants)
		.where(eq(downloadGrants.shopDomain, shop));
	return { grantCount: row.n, totalDownloads: Number(row.downloads ?? 0) };
}

/** Cascade hook for the assets module: an asset is being deleted. */
export async function removeForAsset(env: Env, assetId: string): Promise<void> {
	await db(env.DB).delete(downloadGrants).where(eq(downloadGrants.assetId, assetId));
}

/** Cascade hook for shop/redact: erase every grant the shop has. */
export async function removeAllForShop(env: Env, shop: string): Promise<void> {
	await db(env.DB).delete(downloadGrants).where(eq(downloadGrants.shopDomain, shop));
}

/** GDPR hook for customers/redact: scrub a buyer's email, keep the rows. */
export async function redactEmail(env: Env, email: string): Promise<void> {
	await db(env.DB)
		.update(downloadGrants)
		.set({ orderEmail: "[redacted]" })
		.where(eq(downloadGrants.orderEmail, email));
}
