import { DurableObject } from "cloudflare:workers";
import type { Env } from "../../types";

export type GateDecision =
	| { ok: true; downloadsUsed: number }
	| { ok: false; reason: "expired" | "limit_reached" };

/**
 * One instance per download grant (idFromName(grant token)). The counter lives
 * here — not in D1 — because a Durable Object is single-threaded, so two
 * simultaneous requests for the last remaining download can never both pass.
 * At expiry, an alarm writes the final count back to D1 (the admin-facing copy)
 * and wipes this object's storage.
 */
export class DownloadGate extends DurableObject<Env> {
	async authorize(grant: {
		token: string;
		maxDownloads: number;
		expiresAtMs: number;
	}): Promise<GateDecision> {
		const now = Date.now();
		if (now >= grant.expiresAtMs) {
			return { ok: false, reason: "expired" };
		}

		const used = (await this.ctx.storage.get<number>("used")) ?? 0;
		if (used >= grant.maxDownloads) {
			return { ok: false, reason: "limit_reached" };
		}

		await this.ctx.storage.put("used", used + 1);
		await this.ctx.storage.put("token", grant.token);
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(grant.expiresAtMs);
		}
		return { ok: true, downloadsUsed: used + 1 };
	}

	/** Expiry: persist the final count to D1, then release all DO storage. */
	async alarm(): Promise<void> {
		const token = await this.ctx.storage.get<string>("token");
		const used = (await this.ctx.storage.get<number>("used")) ?? 0;
		if (token) {
			await this.env.DB.prepare(
				"UPDATE download_grants SET downloads_used = ? WHERE token = ?",
			)
				.bind(used, token)
				.run();
		}
		await this.ctx.storage.deleteAll();
	}
}
