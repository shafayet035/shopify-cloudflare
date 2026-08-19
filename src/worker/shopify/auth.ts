import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { RequestedTokenType } from "@shopify/shopify-api";
import { getShopify, isValidShopDomain } from "./client";
import { getShop, upsertShop } from "../db/client";
import type { AppEnv } from "../types";

/**
 * Authenticates embedded-app requests using session tokens + token exchange.
 * No OAuth redirect flow is needed: Shopify installs the app via managed
 * installation (scopes declared in shopify.app.toml), and every request from
 * the embedded frontend carries a short-lived session token (JWT) that we can
 * exchange for a permanent offline access token when we don't have one yet.
 * https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
 */
export const shopifyAuth = createMiddleware<AppEnv>(async (c, next) => {
	const env = c.env;

	// UI-only local development without a Shopify store. Guarded to localhost so
	// this can never be switched on against a deployed Worker.
	const host = new URL(c.req.url).hostname;
	if (env.DEV_BYPASS_AUTH === "1" && (host === "localhost" || host === "127.0.0.1")) {
		// Mirror what token exchange does so foreign keys to shops() hold.
		await upsertShop(env.DB, {
			shopDomain: "dev-shop.myshopify.com",
			accessToken: "dev-bypass",
			scope: "",
		});
		c.set("shop", { shop: "dev-shop.myshopify.com", accessToken: "dev-bypass" });
		await next();
		return;
	}

	const authHeader = c.req.header("Authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return unauthorized(c, "Missing session token");
	}
	const sessionToken = authHeader.slice("Bearer ".length);

	const shopify = getShopify(env);
	let dest: string;
	try {
		// Verifies signature (HS256 with the app secret), expiry, and audience.
		const payload = await shopify.session.decodeSessionToken(sessionToken);
		dest = payload.dest;
	} catch {
		return unauthorized(c, "Invalid session token");
	}

	const shop = new URL(dest).host;
	if (!isValidShopDomain(shop)) {
		return unauthorized(c, "Invalid shop domain");
	}

	// One offline token per shop, stored in D1. If we don't have one (first
	// request after install, or after the token was invalidated), exchange the
	// session token for one — cheap and idempotent.
	let shopRow = await getShop(env.DB, shop);
	if (!shopRow) {
		const { session } = await shopify.auth.tokenExchange({
			shop,
			sessionToken,
			requestedTokenType: RequestedTokenType.OfflineAccessToken,
		});
		if (!session.accessToken) {
			return unauthorized(c, "Token exchange failed");
		}
		shopRow = await upsertShop(env.DB, {
			shopDomain: shop,
			accessToken: session.accessToken,
			scope: session.scope ?? "",
		});
	}

	c.set("shop", { shop, accessToken: shopRow.accessToken });
	await next();
});

function unauthorized(c: Context, message: string) {
	// App Bridge treats a 401 with this header as "get a fresh session token and retry".
	return c.json({ error: message }, 401, {
		"X-Shopify-Retry-Invalid-Session-Request": "1",
	});
}
