import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "./schema";

export function db(d1: D1Database): DrizzleD1Database<typeof schema> {
	return drizzle(d1, { schema });
}

export type ShopRow = typeof schema.shops.$inferSelect;

export async function getShop(d1: D1Database, shopDomain: string): Promise<ShopRow | undefined> {
	const rows = await db(d1)
		.select()
		.from(schema.shops)
		.where(eq(schema.shops.shopDomain, shopDomain));
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
		.insert(schema.shops)
		.values(shop)
		.onConflictDoUpdate({
			target: schema.shops.shopDomain,
			set: {
				accessToken: shop.accessToken,
				scope: shop.scope,
				uninstalledAt: null,
			},
		})
		.returning();
	return row;
}

/** Called when an API call comes back 401 — forces re-exchange on next request. */
export async function deleteShopToken(d1: D1Database, shopDomain: string): Promise<void> {
	await db(d1).delete(schema.shops).where(eq(schema.shops.shopDomain, shopDomain));
}

/** Called from the app/uninstalled webhook job. Keeps the row for history. */
export async function markShopUninstalled(d1: D1Database, shopDomain: string): Promise<void> {
	await db(d1)
		.update(schema.shops)
		.set({ accessToken: "", uninstalledAt: new Date() })
		.where(eq(schema.shops.shopDomain, shopDomain));
}
