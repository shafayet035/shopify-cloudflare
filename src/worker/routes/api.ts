import { Hono } from "hono";
import { and, count, desc, eq, sum } from "drizzle-orm";
import { shopifyAuth } from "../shopify/auth";
import { adminGraphql } from "../shopify/graphql";
import { db } from "../db/client";
import { assets, downloadGrants, productAssets } from "../db/schema";
import { uploadRoutes } from "../r2/multipart";
import type { AppEnv } from "../types";

/** Everything under /api/* — authenticated with a Shopify session token. */
export const apiRoutes = new Hono<AppEnv>();

// /api/health is public: it's the deploy smoke-test (and triggers the D1
// schema bootstrap, which the middleware in index.ts already awaited).
apiRoutes.get("/health", (c) => c.json({ ok: true }));

apiRoutes.use("*", shopifyAuth);

apiRoutes.get("/me", async (c) => {
	const { shop, accessToken } = c.get("shop");
	const d = db(c.env.DB);

	const [assetCount] = await d
		.select({ n: count() })
		.from(assets)
		.where(eq(assets.shopDomain, shop));
	const [grantStats] = await d
		.select({ n: count(), downloads: sum(downloadGrants.downloadsUsed) })
		.from(downloadGrants)
		.where(eq(downloadGrants.shopDomain, shop));

	// One tiny Admin API call so the boilerplate proves the GraphQL path works.
	let shopName = shop;
	if (accessToken !== "dev-bypass") {
		const data = await adminGraphql<{ shop: { name: string } }>(
			c.env,
			shop,
			accessToken,
			`{ shop { name } }`,
		);
		shopName = data.shop.name;
	}

	return c.json({
		shop,
		shopName,
		assetCount: assetCount.n,
		grantCount: grantStats.n,
		totalDownloads: Number(grantStats.downloads ?? 0),
	});
});

apiRoutes.get("/assets", async (c) => {
	const { shop } = c.get("shop");
	const rows = await db(c.env.DB)
		.select()
		.from(assets)
		.where(eq(assets.shopDomain, shop))
		.orderBy(desc(assets.createdAt));

	const links = await db(c.env.DB)
		.select()
		.from(productAssets)
		.where(eq(productAssets.shopDomain, shop));

	return c.json({
		assets: rows.map((a) => ({
			...a,
			products: links.filter((l) => l.assetId === a.id).map((l) => l.productId),
		})),
	});
});

apiRoutes.delete("/assets/:id", async (c) => {
	const { shop } = c.get("shop");
	const id = c.req.param("id");
	const d = db(c.env.DB);

	const [asset] = await d
		.select()
		.from(assets)
		.where(and(eq(assets.id, id), eq(assets.shopDomain, shop)));
	if (!asset) return c.json({ error: "Not found" }, 404);

	await c.env.ASSETS_BUCKET.delete(asset.r2Key);
	await d.delete(productAssets).where(eq(productAssets.assetId, id));
	await d.delete(downloadGrants).where(eq(downloadGrants.assetId, id));
	await d.delete(assets).where(eq(assets.id, id));
	return c.json({ ok: true });
});

// Link/unlink an asset to a product: when that product is purchased, the
// orders/paid job grants the buyer this asset.
apiRoutes.post("/assets/:id/links", async (c) => {
	const { shop } = c.get("shop");
	const assetId = c.req.param("id");
	const { productId } = await c.req.json<{ productId: string }>();
	if (!productId?.trim()) return c.json({ error: "productId is required" }, 400);

	await db(c.env.DB)
		.insert(productAssets)
		.values({ shopDomain: shop, productId: productId.trim(), assetId })
		.onConflictDoNothing();
	return c.json({ ok: true });
});

apiRoutes.delete("/assets/:id/links/:productId", async (c) => {
	const { shop } = c.get("shop");
	await db(c.env.DB)
		.delete(productAssets)
		.where(
			and(
				eq(productAssets.shopDomain, shop),
				eq(productAssets.assetId, c.req.param("id")),
				eq(productAssets.productId, c.req.param("productId")),
			),
		);
	return c.json({ ok: true });
});

apiRoutes.get("/grants", async (c) => {
	const { shop } = c.get("shop");
	const rows = await db(c.env.DB)
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
	return c.json({ grants: rows });
});

apiRoutes.route("/uploads", uploadRoutes);
