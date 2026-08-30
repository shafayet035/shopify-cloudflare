import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createForOrder, redeem } from "../src/worker/features/grants/index";

// Tests hit the Grant module's interface — the same seam the routes use.
describe("grants", () => {
	beforeAll(async () => {
		const coordinator = env.SHOP_COORDINATOR.get(
			env.SHOP_COORDINATOR.idFromName("system:global"),
		);
		await coordinator.runMigrations();

		await env.DB.batch([
			env.DB.prepare(
				"INSERT OR IGNORE INTO shops (shop_domain, access_token, scope, installed_at) VALUES ('t.myshopify.com', 'tok', '', 0)",
			),
			env.DB.prepare(
				"INSERT OR IGNORE INTO assets (id, shop_domain, r2_key, filename, size, content_type, created_at) VALUES ('a1', 't.myshopify.com', 'assets/t.myshopify.com/a1/f.pdf', 'f.pdf', 4, 'application/pdf', 0)",
			),
			env.DB.prepare(
				"INSERT OR IGNORE INTO product_assets (shop_domain, product_id, asset_id) VALUES ('t.myshopify.com', '42', 'a1')",
			),
		]);
		await env.ASSETS_BUCKET.put("assets/t.myshopify.com/a1/f.pdf", "data");
	});

	it("createForOrder is idempotent and returns the full link list", async () => {
		const order = { orderId: "o1", email: "b@example.com", productIds: ["42"] };
		const first = await createForOrder(env, "t.myshopify.com", order);
		expect(first.insertedNew).toBe(true);
		expect(first.links).toHaveLength(1);
		expect(first.links[0].filename).toBe("f.pdf");

		const second = await createForOrder(env, "t.myshopify.com", order);
		expect(second.insertedNew).toBe(false);
		expect(second.links).toHaveLength(1); // still returns the existing link
	});

	it("redeem streams (no R2 creds), counts down, then denies", async () => {
		const { links } = await createForOrder(env, "t.myshopify.com", {
			orderId: "o2",
			email: "b@example.com",
			productIds: ["42"],
		});
		const token = links[0].url.split("/download/")[1];

		for (let i = 0; i < 5; i++) {
			const redemption = await redeem(env, token);
			expect(redemption.kind).toBe("stream");
		}
		const sixth = await redeem(env, token);
		expect(sixth).toEqual({ kind: "denied", reason: "limit_reached" });

		// redeem() is the one live writer of the admin-facing count.
		const row = await env.DB.prepare(
			"SELECT downloads_used FROM download_grants WHERE token = ?",
		)
			.bind(token)
			.first<{ downloads_used: number }>();
		expect(row?.downloads_used).toBe(5);
	});

	it("denies an unknown token", async () => {
		expect(await redeem(env, "nope")).toEqual({ kind: "denied", reason: "not_found" });
	});

	it("denies an expired grant", async () => {
		await env.DB.prepare(
			"INSERT INTO download_grants (token, shop_domain, order_id, order_email, asset_id, max_downloads, downloads_used, expires_at, created_at) VALUES ('expired-tok', 't.myshopify.com', 'o3', 'b@example.com', 'a1', 5, 0, 1000, 0)",
		).run();
		expect(await redeem(env, "expired-tok")).toEqual({ kind: "denied", reason: "expired" });
	});
});
