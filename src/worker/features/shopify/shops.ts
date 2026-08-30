/**
 * Shop-row storage — implementation detail of the shopify module (ADR-0001:
 * domain behaviour lives in feature modules, not table wrappers in shared/).
 * The `shops` table holds one row per installed store with its offline token.
 */
import { eq } from "drizzle-orm";
import { db } from "../../shared/db/client";
import { shops } from "../../shared/db/schema";

export type ShopRow = typeof shops.$inferSelect;

export async function getShop(d1: D1Database, shopDomain: string): Promise<ShopRow | undefined> {
	const rows = await db(d1).select().from(shops).where(eq(shops.shopDomain, shopDomain));
	const row = rows[0];
	// A shop that uninstalled must re-exchange for a fresh token on next open.
	if (!row || row.uninstalledAt) return undefined;
	return row;
}

export async function upsertShop(
	d1: D1Database,
	shop: { shopDomain: string; accessToken: string; scope: string },
): Promise<ShopRow> {
	const [row] = await db(d1)
		.insert(shops)
		.values(shop)
		.onConflictDoUpdate({
			target: shops.shopDomain,
			set: {
				accessToken: shop.accessToken,
				scope: shop.scope,
				uninstalledAt: null,
			},
		})
		.returning();
	return row;
}

/**
 * Removes the shop row entirely — used when a stored token turns out to be
 * revoked (the next authenticated request re-exchanges) and by shop/redact.
 */
export async function deleteShop(d1: D1Database, shopDomain: string): Promise<void> {
	await db(d1).delete(shops).where(eq(shops.shopDomain, shopDomain));
}

/** Called from the app/uninstalled webhook job. Keeps the row for history. */
export async function markShopUninstalled(d1: D1Database, shopDomain: string): Promise<void> {
	await db(d1)
		.update(shops)
		.set({ accessToken: "", uninstalledAt: new Date() })
		.where(eq(shops.shopDomain, shopDomain));
}
