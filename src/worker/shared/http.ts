import type { Context } from "hono";

/**
 * Parse a JSON request body, returning null instead of throwing on malformed
 * input — so routes answer 400, not 500, when a client sends garbage.
 */
export async function readJson<T>(c: Context): Promise<T | null> {
	try {
		return await c.req.json<T>();
	} catch {
		return null;
	}
}
