/**
 * The Shopify platform module. Everything the rest of the app needs from
 * Shopify sits behind three calls:
 *
 *   shopifyAuth            - Hono middleware: session token -> ShopContext
 *   adminGraphql(...)      - run an Admin GraphQL query for a shop
 *   verifyWebhook(...)     - HMAC-check an incoming webhook delivery
 *
 * The official @shopify/shopify-api library is an adapter behind this seam —
 * callers never touch it directly, so swapping it (e.g. for the hand-rolled
 * jose + fetch approach) touches only this file.
 */
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
// The adapter import wires @shopify/shopify-api to the Workers runtime. We
// import its marker constant instead of a bare side-effect import so bundlers
// can never tree-shake it away — if this import is removed, the library throws
// "Missing adapter implementation" at runtime.
import { cfWorkerAdapterInitialized } from "@shopify/shopify-api/adapters/cf-worker";
import {
	shopifyApi,
	LogSeverity,
	RequestedTokenType,
	Session,
	type ApiVersion,
	type Shopify,
} from "@shopify/shopify-api";
import { deleteShop, getShop, upsertShop } from "./shops";
import type { AppEnv, Env } from "../../types";

if (!cfWorkerAdapterInitialized) {
	throw new Error("@shopify/shopify-api cf-worker adapter failed to initialize");
}

// shopifyApi() builds a config object and validates it — cache one instance per
// isolate instead of rebuilding it on every request.
let cached: Shopify | undefined;

function getShopify(env: Env): Shopify {
	cached ??= shopifyApi({
		apiKey: env.SHOPIFY_API_KEY,
		apiSecretKey: env.SHOPIFY_API_SECRET,
		apiVersion: env.SHOPIFY_API_VERSION as ApiVersion,
		isEmbeddedApp: true,
		hostName: new URL(env.SHOPIFY_APP_URL).host,
		logger: { level: LogSeverity.Warning },
	});
	return cached;
}

/** "my-store.myshopify.com" — permanent shop domains only, rejects anything else. */
const SHOP_DOMAIN_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export function isValidShopDomain(shop: string): boolean {
	return SHOP_DOMAIN_RE.test(shop);
}

// ---------------------------------------------------------------------------
// Auth: session token + token exchange (managed installation — no OAuth flow).
// https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/token-exchange
// ---------------------------------------------------------------------------

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
		c.set("shop", { shop: "dev-shop.myshopify.com", accessToken: "dev-bypass", isDevBypass: true });
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

	c.set("shop", { shop, accessToken: shopRow.accessToken, isDevBypass: false });
	await next();
});

function unauthorized(c: Context, message: string) {
	// App Bridge treats a 401 with this header as "get a fresh session token and retry".
	return c.json({ error: message }, 401, {
		"X-Shopify-Retry-Invalid-Session-Request": "1",
	});
}

// ---------------------------------------------------------------------------
// Admin GraphQL
// ---------------------------------------------------------------------------

export class AdminGraphqlError extends Error {
	constructor(
		message: string,
		public readonly status?: number,
		public readonly errors?: unknown,
	) {
		super(message);
		this.name = "AdminGraphqlError";
	}
}

/**
 * Run an Admin GraphQL query/mutation for a shop using its stored offline token.
 * On a 401 (token revoked — e.g. app reinstalled) the stored token is deleted so
 * the next authenticated request performs a fresh token exchange.
 */
export async function adminGraphql<T = unknown>(
	env: Env,
	shop: string,
	accessToken: string,
	query: string,
	variables?: Record<string, unknown>,
): Promise<T> {
	const shopify = getShopify(env);
	const session = new Session({
		id: `offline_${shop}`,
		shop,
		state: "",
		isOnline: false,
		accessToken,
	});
	const client = new shopify.clients.Graphql({ session });

	try {
		const response = await client.request<T>(query, { variables });
		if (response.errors) {
			throw new AdminGraphqlError(
				response.errors.message ?? "GraphQL request failed",
				undefined,
				response.errors.graphQLErrors,
			);
		}
		return response.data as T;
	} catch (error) {
		// HttpResponseError from the library carries the HTTP status code.
		const status = (error as { response?: { code?: number } })?.response?.code;
		if (status === 401) {
			await deleteShop(env.DB, shop);
			throw new AdminGraphqlError("Access token invalid — will re-exchange on next request", 401);
		}
		throw error;
	}
}

/*
 * Billing note: this boilerplate ships no billing code on purpose. For public
 * apps, prefer Shopify App Pricing (plans configured in the Partner dashboard,
 * hosted plan-selection page, zero code):
 * https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing
 *
 * If you need programmatic billing instead, the mutation looks like:
 *
 *   mutation {
 *     appSubscriptionCreate(
 *       name: "Pro"
 *       returnUrl: "https://admin.shopify.com/apps/your-app-handle"
 *       lineItems: [{ plan: { appRecurringPricingDetails: {
 *         price: { amount: 9.99, currencyCode: USD }, interval: EVERY_30_DAYS
 *       }}}]
 *     ) { confirmationUrl userErrors { field message } }
 *   }
 *
 * Redirect the merchant to confirmationUrl and watch APP_SUBSCRIPTIONS_UPDATE.
 */

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface VerifiedWebhook {
	shop: string;
	/** Normalized to GraphQL enum form by the library, e.g. "ORDERS_PAID". */
	topic: string;
}

/**
 * HMAC-verify an incoming webhook delivery (SHA-256 of the raw body against
 * X-Shopify-Hmac-Sha256). Returns null when invalid — respond 401 in that case;
 * App Store review sends deliberately bad HMACs.
 */
export async function verifyWebhook(
	env: Env,
	request: Request,
	rawBody: string,
): Promise<VerifiedWebhook | null> {
	const validation = await getShopify(env).webhooks.validate({
		rawBody,
		rawRequest: request,
	});
	if (!validation.valid) return null;
	return { shop: validation.domain, topic: validation.topic };
}
