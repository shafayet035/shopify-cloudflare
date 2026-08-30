import { MIGRATIONS } from "./migrations.gen";
import type { Env } from "../../types";

/**
 * Self-applying D1 schema. On the first request an isolate serves, we ask the
 * single global ShopCoordinator instance to run any pending migrations — the
 * Durable Object serializes concurrent callers, so parallel cold starts (or a
 * fresh click-deploy) can never race the schema. After the first check the
 * result is memoized per isolate, so steady-state cost is zero.
 *
 * This is the canonical migration mechanism — do NOT also run
 * `wrangler d1 migrations apply` (it tracks state in its own table and the two
 * will drift). To apply new migrations after a deploy, any request works:
 * `npm run db:migrate` just curls /api/health.
 */
let ready: Promise<void> | undefined;

export function ensureDbReady(env: Env): Promise<void> {
	ready ??= env.SHOP_COORDINATOR.get(
		env.SHOP_COORDINATOR.idFromName("system:global"),
	)
		.runMigrations()
		.catch((error) => {
			ready = undefined; // let the next request retry
			throw error;
		});
	return ready;
}

/** Applies pending migrations. Called only inside ShopCoordinator's lock. */
export async function applyMigrations(d1: D1Database): Promise<void> {
	await d1
		.prepare(
			"CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)",
		)
		.run();

	const { results } = await d1
		.prepare("SELECT version FROM schema_migrations")
		.all<{ version: string }>();
	const applied = new Set(results.map((r) => r.version));

	for (const migration of MIGRATIONS) {
		if (applied.has(migration.version)) continue;

		// drizzle-kit separates statements with this marker.
		const statements = migration.sql
			.split("--> statement-breakpoint")
			.map((s) => s.trim())
			.filter(Boolean);

		await d1.batch([
			...statements.map((sql) => d1.prepare(sql)),
			d1
				.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
				.bind(migration.version, Date.now()),
		]);
	}
}
