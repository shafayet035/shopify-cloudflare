import { Hono, type Context } from "hono";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { assets, downloadGrants } from "../db/schema";
import { presignConfigured, presignDownloadUrl } from "../r2/presign";
import type { AppEnv } from "../types";

/**
 * Public download endpoint — the links buyers get by email.
 * Flow: D1 grant lookup -> DownloadGate (atomic limit check) -> deliver.
 * Delivery is a 302 to a short-lived presigned R2 URL when the R2_* secrets
 * are configured, and otherwise streams the file through the Worker (zero
 * extra setup, fine for smaller files).
 */
export const downloadRoutes = new Hono<AppEnv>();

downloadRoutes.get("/:token", async (c) => {
	const token = c.req.param("token");

	const [grant] = await db(c.env.DB)
		.select({
			token: downloadGrants.token,
			maxDownloads: downloadGrants.maxDownloads,
			expiresAt: downloadGrants.expiresAt,
			r2Key: assets.r2Key,
			filename: assets.filename,
			contentType: assets.contentType,
		})
		.from(downloadGrants)
		.innerJoin(assets, eq(downloadGrants.assetId, assets.id))
		.where(eq(downloadGrants.token, token));

	if (!grant) {
		return errorPage(c, 404, "This download link doesn't exist.");
	}

	const gate = c.env.DOWNLOAD_GATE.get(c.env.DOWNLOAD_GATE.idFromName(token));
	const decision = await gate.authorize({
		token,
		maxDownloads: grant.maxDownloads,
		expiresAtMs: grant.expiresAt.getTime(),
	});
	if (!decision.ok) {
		const message =
			decision.reason === "expired"
				? "This download link has expired."
				: "This link has reached its download limit.";
		return errorPage(c, 410, message);
	}

	// Keep the admin-facing count in D1 roughly in sync without blocking delivery.
	c.executionCtx.waitUntil(
		db(c.env.DB)
			.update(downloadGrants)
			.set({ downloadsUsed: sql`${downloadGrants.downloadsUsed} + 1` })
			.where(eq(downloadGrants.token, token))
			.then(() => {}),
	);

	if (presignConfigured(c.env)) {
		const url = await presignDownloadUrl(c.env, grant.r2Key, grant.filename);
		return c.redirect(url, 302);
	}

	// Streaming fallback: proxy the object through the Worker.
	const object = await c.env.ASSETS_BUCKET.get(grant.r2Key);
	if (!object) return errorPage(c, 404, "File not found.");
	return new Response(object.body, {
		headers: {
			"Content-Type": grant.contentType,
			"Content-Length": String(object.size),
			"Content-Disposition": `attachment; filename="${grant.filename.replaceAll('"', "")}"`,
			etag: object.httpEtag,
		},
	});
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
