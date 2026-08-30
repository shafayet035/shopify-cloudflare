import { Hono, type Context } from "hono";
import { listForShop, redeem } from "./index";
import { attachmentDisposition } from "../../shared/r2";
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
					"Content-Disposition": attachmentDisposition(redemption.filename),
					etag: redemption.etag,
				},
			});
		case "denied": {
			const message = {
				not_found: "This download link doesn't exist.",
				expired: "This download link has expired.",
				limit_reached: "This link has reached its download limit.",
				file_missing: "File not found.",
			}[redemption.reason];
			return errorPage(c, redemption.reason === "expired" || redemption.reason === "limit_reached" ? 410 : 404, message);
		}
	}
});

/** Admin-facing grant listing (behind shopifyAuth — mounted under /api). */
export const grantApiRoutes = new Hono<AppEnv>();

grantApiRoutes.get("/", async (c) => {
	const { shop } = c.get("shop");
	return c.json({ grants: await listForShop(c.env, shop) });
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
