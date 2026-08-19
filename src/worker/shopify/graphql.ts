import { Session } from "@shopify/shopify-api";
import { getShopify } from "./client";
import { deleteShopToken } from "../db/client";
import type { Env } from "../types";

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
 * Example:
 *   const data = await adminGraphql<{ shop: { name: string } }>(
 *     env, shop, accessToken, `{ shop { name } }`);
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
			await deleteShopToken(env.DB, shop);
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
