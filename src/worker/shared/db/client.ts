import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

/**
 * The one shared piece of database plumbing: a typed Drizzle handle. Queries
 * live in the feature modules that own the tables (see ADR-0001 — no
 * repository layer).
 */
export function db(d1: D1Database): DrizzleD1Database<typeof schema> {
	return drizzle(d1, { schema });
}
