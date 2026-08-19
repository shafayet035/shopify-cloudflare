import { Hono } from "hono";
import { db } from "../db/client";
import { assets } from "../db/schema";
import type { AppEnv } from "../types";

/**
 * Multipart upload broker: the browser sends parts through these endpoints and
 * the Worker writes them to R2 with the bucket binding — no R2 credentials in
 * the client, no file-size limits from a single request body.
 * Pattern from https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
 *
 * All routes are mounted behind shopifyAuth (see routes/api.ts), and every key
 * is namespaced under the authenticated shop so shops can't touch each other's
 * files.
 */
export const uploadRoutes = new Hono<AppEnv>();

function shopKey(shop: string, assetId: string, filename: string): string {
	// Key layout: assets/{shop}/{assetId}/{filename}
	return `assets/${shop}/${assetId}/${filename}`;
}

function assertOwnKey(shop: string, key: string): void {
	if (!key.startsWith(`assets/${shop}/`)) {
		throw new Error("Key does not belong to this shop");
	}
}

uploadRoutes.post("/", async (c) => {
	const { shop } = c.get("shop");
	const body = await c.req.json<{ filename: string; contentType?: string }>();
	const filename = (body.filename ?? "").replaceAll("/", "_").trim();
	if (!filename) return c.json({ error: "filename is required" }, 400);

	const assetId = crypto.randomUUID();
	const key = shopKey(shop, assetId, filename);
	const upload = await c.env.ASSETS_BUCKET.createMultipartUpload(key, {
		httpMetadata: { contentType: body.contentType ?? "application/octet-stream" },
	});

	return c.json({ assetId, key, uploadId: upload.uploadId });
});

uploadRoutes.put("/:assetId/parts/:partNumber", async (c) => {
	const { shop } = c.get("shop");
	const key = c.req.query("key");
	const uploadId = c.req.query("uploadId");
	const partNumber = Number(c.req.param("partNumber"));
	if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
		return c.json({ error: "key, uploadId and a positive partNumber are required" }, 400);
	}
	assertOwnKey(shop, key);
	if (!c.req.raw.body) return c.json({ error: "missing request body" }, 400);

	const upload = c.env.ASSETS_BUCKET.resumeMultipartUpload(key, uploadId);
	const part = await upload.uploadPart(partNumber, c.req.raw.body);
	return c.json({ partNumber: part.partNumber, etag: part.etag });
});

uploadRoutes.post("/:assetId/complete", async (c) => {
	const { shop } = c.get("shop");
	const assetId = c.req.param("assetId");
	const body = await c.req.json<{
		key: string;
		uploadId: string;
		parts: { partNumber: number; etag: string }[];
		filename: string;
		contentType?: string;
	}>();
	assertOwnKey(shop, body.key);

	const upload = c.env.ASSETS_BUCKET.resumeMultipartUpload(body.key, body.uploadId);
	const object = await upload.complete(body.parts);

	const [row] = await db(c.env.DB)
		.insert(assets)
		.values({
			id: assetId,
			shopDomain: shop,
			r2Key: body.key,
			filename: body.filename,
			size: object.size,
			contentType: body.contentType ?? "application/octet-stream",
		})
		.returning();

	return c.json({ asset: row });
});

uploadRoutes.delete("/:assetId/abort", async (c) => {
	const { shop } = c.get("shop");
	const key = c.req.query("key");
	const uploadId = c.req.query("uploadId");
	if (!key || !uploadId) return c.json({ error: "key and uploadId are required" }, 400);
	assertOwnKey(shop, key);

	const upload = c.env.ASSETS_BUCKET.resumeMultipartUpload(key, uploadId);
	await upload.abort();
	return c.json({ ok: true });
});
