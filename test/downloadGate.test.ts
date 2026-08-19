import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("DownloadGate", () => {
	it("allows up to maxDownloads, then blocks atomically", async () => {
		const gate = env.DOWNLOAD_GATE.get(env.DOWNLOAD_GATE.idFromName("gate-test-1"));
		const grant = { token: "gate-test-1", maxDownloads: 2, expiresAtMs: Date.now() + 60_000 };

		expect(await gate.authorize(grant)).toEqual({ ok: true, downloadsUsed: 1 });
		expect(await gate.authorize(grant)).toEqual({ ok: true, downloadsUsed: 2 });
		expect(await gate.authorize(grant)).toEqual({ ok: false, reason: "limit_reached" });
	});

	it("rejects expired grants", async () => {
		const gate = env.DOWNLOAD_GATE.get(env.DOWNLOAD_GATE.idFromName("gate-test-2"));
		const decision = await gate.authorize({
			token: "gate-test-2",
			maxDownloads: 5,
			expiresAtMs: Date.now() - 1,
		});
		expect(decision).toEqual({ ok: false, reason: "expired" });
	});
});

describe("D1 bootstrap", () => {
	it("is idempotent under concurrent cold starts", async () => {
		const coordinator = env.SHOP_COORDINATOR.get(
			env.SHOP_COORDINATOR.idFromName("system:global"),
		);
		await Promise.all(Array.from({ length: 10 }, () => coordinator.runMigrations()));

		const { results } = await env.DB.prepare(
			"SELECT name FROM sqlite_master WHERE type='table' AND name='shops'",
		).all();
		expect(results).toHaveLength(1);
	});
});
