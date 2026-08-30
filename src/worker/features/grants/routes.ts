import { Hono, type Context } from "hono";
import { desc, eq } from "drizzle-orm";
import { redeem } from "./index";
import { db } from "../../shared/db/client";
import { assets, downloadGrants } from "../../shared/db/schema";
import type { AppEnv } from "../../types";

/** Public download endpoint — the links buyers get by email. A thin HTTP mapper over redeem(). */
export const downloadRoutes = new Hono<AppEnv>();

downloadRoutes.get("/:token", async (c) => {
	const redemption = await redeem(c.env, c.req.param("token"));
	switch (redemption.kind) {
		case "redirect":
			return c.redirect(redemption.url, 302);
		case "stream":
			return new Response(redemption.body, {
				headers: {
					"Content-Type": redemption.contentType,
					"Content-Length": String(redemption.size),
					"Content-Disposition": `attachment; filename="${redemption.filename.replaceAll('"', "")}"`,
					etag: redemption.etag,
				},
			});
		case "denied": {
			const message = {
				not_found: "This download link doesn't exist.",
				expired: "This download link has expired.",
				limit_reached: "This link has reached its download limit.",
			}[redemption.reason];
			return errorPage(c, redemption.reason === "not_found" ? 404 : 410, message);
		}
	}
});

/** Admin-facing grant listing (behind shopifyAuth — mounted under /api). */
export const grantApiRoutes = new Hono<AppEnv>();

grantApiRoutes.get("/", async (c) => {
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

function errorPage(c: Context, status: 404 | 410, message: string) {
	return c.html(
		`<!doctype html><html><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:80vh">
			<div style="text-align:center"><h1 style="font-size:20px">Download unavailable</h1><p>${message}</p>
			<p style="color:#666;font-size:13px">Contact the store you purchased from for help.</p></div>
		</body></html>`,
		status,
	);
}
