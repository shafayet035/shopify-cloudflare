import { Hono } from "hono";
import { count, eq, sum } from "drizzle-orm";
import { adminGraphql } from "../shopify/index";
import { db } from "../../shared/db/client";
import { assets, downloadGrants } from "../../shared/db/schema";
import type { AppEnv } from "../../types";

/** /api/me — everything the Dashboard page shows. Mounted behind shopifyAuth. */
export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/me", async (c) => {
	const { shop, accessToken } = c.get("shop");
	const d = db(c.env.DB);

	const [[assetCount], [grantStats]] = await Promise.all([
		d.select({ n: count() }).from(assets).where(eq(assets.shopDomain, shop)),
		d
			.select({ n: count(), downloads: sum(downloadGrants.downloadsUsed) })
			.from(downloadGrants)
			.where(eq(downloadGrants.shopDomain, shop)),
	]);

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
