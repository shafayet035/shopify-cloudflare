import { Hono } from "hono";
import {
	AssetAccessError,
	abortUpload,
	beginUpload,
	finishUpload,
	linkProduct,
	listAssets,
	removeAsset,
	unlinkProduct,
	uploadPart,
} from "./index";
import type { AppEnv } from "../../types";

/**
 * Thin HTTP mapping over the Asset module. Mounted under /api behind
 * shopifyAuth: /api/assets/* and /api/uploads/*.
 */
export const assetApiRoutes = new Hono<AppEnv>();

assetApiRoutes.onError((error, c) => {
	if (error instanceof AssetAccessError) {
		return c.json({ error: error.message }, 403);
	}
	throw error;
});

assetApiRoutes.get("/assets", async (c) => {
	const { shop } = c.get("shop");
	return c.json({ assets: await listAssets(c.env, shop) });
});

assetApiRoutes.delete("/assets/:id", async (c) => {
	const { shop } = c.get("shop");
	const removed = await removeAsset(c.env, shop, c.req.param("id"));
	return removed ? c.json({ ok: true }) : c.json({ error: "Not found" }, 404);
});

assetApiRoutes.post("/assets/:id/links", async (c) => {
	const { shop } = c.get("shop");
	const { productId } = await c.req.json<{ productId: string }>();
	if (!productId?.trim()) return c.json({ error: "productId is required" }, 400);
	await linkProduct(c.env, shop, c.req.param("id"), productId.trim());
	return c.json({ ok: true });
});

assetApiRoutes.delete("/assets/:id/links/:productId", async (c) => {
	const { shop } = c.get("shop");
	await unlinkProduct(c.env, shop, c.req.param("id"), c.req.param("productId"));
	return c.json({ ok: true });
});

assetApiRoutes.post("/uploads", async (c) => {
	const { shop } = c.get("shop");
	const body = await c.req.json<{ filename: string; contentType?: string }>();
	const filename = (body.filename ?? "").trim();
	if (!filename) return c.json({ error: "filename is required" }, 400);
	return c.json(
		await beginUpload(c.env, shop, filename, body.contentType ?? "application/octet-stream"),
	);
});

assetApiRoutes.put("/uploads/:assetId/parts/:partNumber", async (c) => {
	const { shop } = c.get("shop");
	const key = c.req.query("key");
	const uploadId = c.req.query("uploadId");
	const partNumber = Number(c.req.param("partNumber"));
	if (!key || !uploadId || !Number.isInteger(partNumber) || partNumber < 1) {
		return c.json({ error: "key, uploadId and a positive partNumber are required" }, 400);
	}
	if (!c.req.raw.body) return c.json({ error: "missing request body" }, 400);
	return c.json(await uploadPart(c.env, shop, { key, uploadId, partNumber, body: c.req.raw.body }));
});

assetApiRoutes.post("/uploads/:assetId/complete", async (c) => {
	const { shop } = c.get("shop");
	const body = await c.req.json<{
		key: string;
		uploadId: string;
		parts: { partNumber: number; etag: string }[];
		filename: string;
		contentType?: string;
	}>();
	const asset = await finishUpload(c.env, shop, {
		assetId: c.req.param("assetId"),
		key: body.key,
		uploadId: body.uploadId,
		parts: body.parts,
		filename: body.filename,
		contentType: body.contentType ?? "application/octet-stream",
	});
	return c.json({ asset });
});

assetApiRoutes.delete("/uploads/:assetId/abort", async (c) => {
	const { shop } = c.get("shop");
	const key = c.req.query("key");
	const uploadId = c.req.query("uploadId");
	if (!key || !uploadId) return c.json({ error: "key and uploadId are required" }, 400);
	await abortUpload(c.env, shop, { key, uploadId });
	return c.json({ ok: true });
});
