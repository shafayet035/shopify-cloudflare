/**
 * The Asset module: files a merchant uploads and links to products.
 *
 * Interface: beginUpload / uploadPart / finishUpload / abortUpload / list /
 * remove / linkProduct / unlinkProduct. R2 (multipart) and the D1 rows are
 * implementation — the key layout `assets/{shop}/{assetId}/{filename}` and the
 * delete cascade live only here.
 *
 * Multipart pattern per
 * https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
 */
import { and, count, desc, eq } from "drizzle-orm";
import { db } from "../../shared/db/client";
import { assets, productAssets } from "../../shared/db/schema";
import { removeForAsset as removeGrantsForAsset } from "../grants/index";
import type { Env } from "../../types";

export class AssetAccessError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AssetAccessError";
	}
}

/** Identifies one in-progress multipart upload. */
export interface UploadRef {
	key: string;
	uploadId: string;
}

function assertOwnKey(shop: string, key: string): void {
	if (!key.startsWith(`assets/${shop}/`)) {
		throw new AssetAccessError("Key does not belong to this shop");
	}
}

export async function beginUpload(
	env: Env,
	shop: string,
	filename: string,
	contentType: string,
): Promise<{ assetId: string; key: string; uploadId: string }> {
	const assetId = crypto.randomUUID();
	const key = `assets/${shop}/${assetId}/${filename.replaceAll("/", "_").trim()}`;
	const upload = await env.ASSETS_BUCKET.createMultipartUpload(key, {
		httpMetadata: { contentType },
	});
	return { assetId, key, uploadId: upload.uploadId };
}

export async function uploadPart(
	env: Env,
	shop: string,
	params: UploadRef & { partNumber: number; body: ReadableStream },
): Promise<{ partNumber: number; etag: string }> {
	assertOwnKey(shop, params.key);
	const upload = env.ASSETS_BUCKET.resumeMultipartUpload(params.key, params.uploadId);
	const part = await upload.uploadPart(params.partNumber, params.body);
	return { partNumber: part.partNumber, etag: part.etag };
}

export async function finishUpload(
	env: Env,
	shop: string,
	params: UploadRef & {
		assetId: string;
		parts: { partNumber: number; etag: string }[];
		filename: string;
		contentType: string;
	},
): Promise<typeof assets.$inferSelect> {
	assertOwnKey(shop, params.key);
	const upload = env.ASSETS_BUCKET.resumeMultipartUpload(params.key, params.uploadId);
	const object = await upload.complete(params.parts);

	const [row] = await db(env.DB)
		.insert(assets)
		.values({
			id: params.assetId,
			shopDomain: shop,
			r2Key: params.key,
			filename: params.filename,
			size: object.size,
			contentType: params.contentType,
		})
		.returning();
	return row;
}

export async function abortUpload(
	env: Env,
	shop: string,
	params: UploadRef,
): Promise<void> {
	assertOwnKey(shop, params.key);
	await env.ASSETS_BUCKET.resumeMultipartUpload(params.key, params.uploadId).abort();
}

export async function listAssets(env: Env, shop: string) {
	const d = db(env.DB);
	const rows = await d
		.select()
		.from(assets)
		.where(eq(assets.shopDomain, shop))
		.orderBy(desc(assets.createdAt));
	const links = await d
		.select()
		.from(productAssets)
		.where(eq(productAssets.shopDomain, shop));
	return rows.map((a) => ({
		...a,
		products: links.filter((l) => l.assetId === a.id).map((l) => l.productId),
	}));
}

/** Deletes the file and everything that references it. Returns false if not found. */
export async function removeAsset(env: Env, shop: string, assetId: string): Promise<boolean> {
	const d = db(env.DB);
	const [asset] = await d
		.select()
		.from(assets)
		.where(and(eq(assets.id, assetId), eq(assets.shopDomain, shop)));
	if (!asset) return false;

	await env.ASSETS_BUCKET.delete(asset.r2Key);
	await d.delete(productAssets).where(eq(productAssets.assetId, assetId));
	await removeGrantsForAsset(env, assetId); // grants owns its own rows
	await d.delete(assets).where(eq(assets.id, assetId));
	return true;
}

export async function countForShop(env: Env, shop: string): Promise<number> {
	const [row] = await db(env.DB)
		.select({ n: count() })
		.from(assets)
		.where(eq(assets.shopDomain, shop));
	return row.n;
}

/** Cascade hook for shop/redact: every file and link the shop has. */
export async function removeAllForShop(env: Env, shop: string): Promise<void> {
	// R2 objects for the shop are namespaced under assets/{shop}/
	let cursor: string | undefined;
	do {
		const listing = await env.ASSETS_BUCKET.list({ prefix: `assets/${shop}/`, cursor });
		if (listing.objects.length > 0) {
			await env.ASSETS_BUCKET.delete(listing.objects.map((o) => o.key));
		}
		cursor = listing.truncated ? listing.cursor : undefined;
	} while (cursor);

	const d = db(env.DB);
	await d.delete(productAssets).where(eq(productAssets.shopDomain, shop));
	await d.delete(assets).where(eq(assets.shopDomain, shop));
}

/** When productId is purchased, the orders/paid job grants the buyer this asset. */
export async function linkProduct(
	env: Env,
	shop: string,
	assetId: string,
	productId: string,
): Promise<void> {
	await db(env.DB)
		.insert(productAssets)
		.values({ shopDomain: shop, productId, assetId })
		.onConflictDoNothing();
}

export async function unlinkProduct(
	env: Env,
	shop: string,
	assetId: string,
	productId: string,
): Promise<void> {
	await db(env.DB)
		.delete(productAssets)
		.where(
			and(
				eq(productAssets.shopDomain, shop),
				eq(productAssets.assetId, assetId),
				eq(productAssets.productId, productId),
			),
		);
}
