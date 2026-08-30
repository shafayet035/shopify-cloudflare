/**
 * The Dashboard module: everything the admin home page shows, gathered through
 * the owning modules' interfaces (assets, grants) plus one Admin GraphQL call
 * that proves the platform path works.
 */
import { adminGraphql } from "../shopify/index";
import { countForShop } from "../assets/index";
import { statsForShop } from "../grants/index";
import type { MeResponse } from "../../../shared/api-types";
import type { Env, ShopContext } from "../../types";

export async function getDashboard(env: Env, ctx: ShopContext): Promise<MeResponse> {
	const [assetCount, grantStats] = await Promise.all([
		countForShop(env, ctx.shop),
		statsForShop(env, ctx.shop),
	]);

	let shopName = ctx.shop;
	if (!ctx.isDevBypass) {
		const data = await adminGraphql<{ shop: { name: string } }>(
			env,
			ctx.shop,
			ctx.accessToken,
			`{ shop { name } }`,
		);
		shopName = data.shop.name;
	}

	return {
		shop: ctx.shop,
		shopName,
		assetCount,
		...grantStats,
	};
}
