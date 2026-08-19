import { markShopUninstalled } from "../../db/client";
import type { Env } from "../../types";

/**
 * app/uninstalled: drop the (now revoked) access token and remember the shop
 * uninstalled. If they reinstall, the auth middleware token-exchanges again.
 */
export async function handleAppUninstalled(env: Env, shop: string): Promise<void> {
	await markShopUninstalled(env.DB, shop);
}
