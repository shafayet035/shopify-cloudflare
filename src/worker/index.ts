import { Hono } from "hono";
import { ensureDbReady } from "./shared/db/bootstrap";
import { handleQueueBatch } from "./shared/queue";
import { isValidShopDomain, shopifyAuth } from "./features/shopify/index";
import { webhookRoutes } from "./features/shopify/routes";
import { dashboardRoutes } from "./features/dashboard/routes";
import { assetApiRoutes } from "./features/assets/routes";
import { downloadRoutes, grantApiRoutes } from "./features/grants/routes";
import type { AppEnv, Env, JobMessage } from "./types";

// Durable Object classes must be exported from the Worker entrypoint.
export { ShopCoordinator } from "./shared/ShopCoordinator";
export { DownloadGate } from "./features/grants/DownloadGate";

const app = new Hono<AppEnv>();

// D1 schema is self-applying (see shared/db/bootstrap.ts) — after the first
// request per isolate this await resolves instantly.
app.use("*", async (c, next) => {
	await ensureDbReady(c.env);
	await next();
});

// /api/* — authenticated with a Shopify session token, except /api/health
// (the deploy smoke-test, which also triggers the D1 bootstrap above).
const api = new Hono<AppEnv>();
api.get("/health", (c) => c.json({ ok: true }));
api.use("*", shopifyAuth);
api.route("/", dashboardRoutes); // /api/me
api.route("/", assetApiRoutes); // /api/assets, /api/uploads
api.route("/grants", grantApiRoutes); // /api/grants

app.route("/api", api);
app.route("/webhooks", webhookRoutes);
app.route("/download", downloadRoutes);

/**
 * Everything else: serve the SPA. wrangler.jsonc routes all non-/assets/*
 * requests through the Worker first so HTML responses can get two per-request
 * additions that static hosting can't provide:
 *  1. the App Bridge meta tag with the real API key (a secret, not baked into
 *     the build), and
 *  2. the Content-Security-Policy frame-ancestors header scoped to the
 *     requesting shop — required for embedded apps.
 */
app.get("*", async (c) => {
	const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
	const contentType = assetResponse.headers.get("Content-Type") ?? "";
	if (!contentType.includes("text/html")) {
		return assetResponse; // favicon, manifest, etc. — pass straight through
	}

	let html = await assetResponse.text();
	html = html.replaceAll("%SHOPIFY_API_KEY%", c.env.SHOPIFY_API_KEY ?? "");

	const headers = new Headers(assetResponse.headers);
	const shop = new URL(c.req.url).searchParams.get("shop");
	headers.set(
		"Content-Security-Policy",
		shop && isValidShopDomain(shop)
			? `frame-ancestors https://${shop} https://admin.shopify.com;`
			: "frame-ancestors https://admin.shopify.com;",
	);
	headers.delete("Content-Length"); // length changed after injection

	return new Response(html, { status: assetResponse.status, headers });
});

export default {
	fetch: app.fetch,
	queue: handleQueueBatch,
} satisfies ExportedHandler<Env, JobMessage>;
