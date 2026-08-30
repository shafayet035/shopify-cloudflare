import { eq } from "drizzle-orm";
import { db, markShopUninstalled } from "../../shared/db/client";
import { assets, downloadGrants, productAssets, shops } from "../../shared/db/schema";
import type { Env } from "../../types";

/**
 * Shop-lifecycle webhook jobs: uninstall + the mandatory GDPR/privacy topics.
 * https://shopify.dev/docs/apps/build/compliance/privacy-law-compliance
 */

// Topics arrive in @shopify/shopify-api's normalized GraphQL enum form.
export const COMPLIANCE_TOPICS = new Set([
	"CUSTOMERS_DATA_REQUEST",
	"CUSTOMERS_REDACT",
	"SHOP_REDACT",
]);

/**
 * app/uninstalled: drop the (now revoked) access token and remember the shop
 * uninstalled. If they reinstall, the auth middleware token-exchanges again.
 */
export async function handleAppUninstalled(env: Env, shop: string): Promise<void> {
	await markShopUninstalled(env.DB, shop);
}

/**
 * The endpoint already returned 200 (that satisfies the delivery requirement);
 * YOU are responsible for actually fulfilling each request within 30 days.
 * The handlers below cover the data this boilerplate stores — extend them for
 * any customer data your app adds.
 */
export async function handleCompliance(
	env: Env,
	topic: string,
	shop: string,
	payload: unknown,
): Promise<void> {
	switch (topic) {
		case "CUSTOMERS_DATA_REQUEST": {
			// A customer asked the merchant for their data. This app only stores
			// order emails on download grants — compile and send them to the
			// merchant if requested. Left as a logged stub: most apps handle the
			// rare request manually.
			console.log(`[compliance] customers/data_request from ${shop}:`, payload);
			return;
		}
		case "CUSTOMERS_REDACT": {
			// Erase this customer's personal data. For this app that's the
			// order_email on their grants (keep the rows so counts stay correct).
			const customer = (payload as { customer?: { email?: string } }).customer;
			if (customer?.email) {
				await db(env.DB)
					.update(downloadGrants)
					.set({ orderEmail: "[redacted]" })
					.where(eq(downloadGrants.orderEmail, customer.email));
			}
			return;
		}
		case "SHOP_REDACT": {
			// Sent 48h after uninstall: erase everything about the shop.
			const d = db(env.DB);
			await d.delete(downloadGrants).where(eq(downloadGrants.shopDomain, shop));
			await d.delete(productAssets).where(eq(productAssets.shopDomain, shop));
			// R2 objects for the shop are namespaced under assets/{shop}/
			let cursor: string | undefined;
			do {
				const listing = await env.ASSETS_BUCKET.list({ prefix: `assets/${shop}/`, cursor });
				if (listing.objects.length > 0) {
					await env.ASSETS_BUCKET.delete(listing.objects.map((o) => o.key));
				}
				cursor = listing.truncated ? listing.cursor : undefined;
			} while (cursor);
			await d.delete(assets).where(eq(assets.shopDomain, shop));
			await d.delete(shops).where(eq(shops.shopDomain, shop));
			return;
		}
	}
}
