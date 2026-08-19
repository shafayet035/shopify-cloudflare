import { DurableObject } from "cloudflare:workers";
import { applyMigrations } from "../db/bootstrap";
import type { Env } from "../types";

const WEBHOOK_RETENTION_MS = 48 * 60 * 60 * 1000; // Shopify retries max out well within 48h

/**
 * One instance per shop (idFromName(shopDomain)) — serializes per-shop work:
 *  - webhook dedup (Shopify delivers at-least-once and retries on timeouts)
 *  - simple named locks for anything else you add (syncs, imports, ...)
 *
 * One extra global instance (idFromName("system:global")) owns the D1
 * migration lock — see db/bootstrap.ts.
 */
export class ShopCoordinator extends DurableObject<Env> {
	private migrated = false;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS seen_webhooks (id TEXT PRIMARY KEY, seen_at INTEGER NOT NULL)",
		);
		this.ctx.storage.sql.exec(
			"CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)",
		);
	}

	/** Returns true if this webhook id was already processed (drop it). */
	async seenWebhook(webhookId: string): Promise<boolean> {
		const existing = this.ctx.storage.sql
			.exec("SELECT id FROM seen_webhooks WHERE id = ?", webhookId)
			.toArray();
		if (existing.length > 0) return true;

		this.ctx.storage.sql.exec(
			"INSERT INTO seen_webhooks (id, seen_at) VALUES (?, ?)",
			webhookId,
			Date.now(),
		);
		// One standing alarm prunes old ids so storage never grows unbounded.
		if ((await this.ctx.storage.getAlarm()) === null) {
			await this.ctx.storage.setAlarm(Date.now() + WEBHOOK_RETENTION_MS);
		}
		return false;
	}

	/** Best-effort named lock with TTL. Returns true if acquired. */
	async acquireLock(name: string, ttlMs: number): Promise<boolean> {
		const now = Date.now();
		this.ctx.storage.sql.exec("DELETE FROM locks WHERE expires_at < ?", now);
		const held = this.ctx.storage.sql
			.exec("SELECT name FROM locks WHERE name = ?", name)
			.toArray();
		if (held.length > 0) return false;
		this.ctx.storage.sql.exec(
			"INSERT INTO locks (name, expires_at) VALUES (?, ?)",
			name,
			now + ttlMs,
		);
		return true;
	}

	async releaseLock(name: string): Promise<void> {
		this.ctx.storage.sql.exec("DELETE FROM locks WHERE name = ?", name);
	}

	/**
	 * D1 schema bootstrap — only ever called on the "system:global" instance.
	 * blockConcurrencyWhile pauses all other calls to this object, so exactly
	 * one caller applies migrations no matter how many isolates race here.
	 */
	async runMigrations(): Promise<void> {
		if (this.migrated) return;
		await this.ctx.blockConcurrencyWhile(async () => {
			if (this.migrated) return;
			await applyMigrations(this.env.DB);
			this.migrated = true;
		});
	}

	async alarm(): Promise<void> {
		const cutoff = Date.now() - WEBHOOK_RETENTION_MS;
		this.ctx.storage.sql.exec("DELETE FROM seen_webhooks WHERE seen_at < ?", cutoff);
		const remaining = this.ctx.storage.sql
			.exec("SELECT COUNT(*) AS n FROM seen_webhooks")
			.one() as { n: number };
		if (remaining.n > 0) {
			await this.ctx.storage.setAlarm(Date.now() + WEBHOOK_RETENTION_MS);
		}
	}
}
