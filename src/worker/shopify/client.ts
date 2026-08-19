// The adapter import wires @shopify/shopify-api to the Workers runtime
// (fetch, WebCrypto, Request/Response). We import its marker constant instead
// of a bare side-effect import so bundlers can never tree-shake it away —
// if this import is removed, the library throws "Missing adapter implementation"
// at runtime.
import { cfWorkerAdapterInitialized } from "@shopify/shopify-api/adapters/cf-worker";
import {
	shopifyApi,
	LogSeverity,
	type ApiVersion,
	type Shopify,
} from "@shopify/shopify-api";
import type { Env } from "../types";

if (!cfWorkerAdapterInitialized) {
	throw new Error("@shopify/shopify-api cf-worker adapter failed to initialize");
}

// shopifyApi() builds a config object and validates it — cache one instance per
// isolate instead of rebuilding it on every request.
let cached: Shopify | undefined;

export function getShopify(env: Env): Shopify {
	if (cached) return cached;
	cached = shopifyApi({
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
