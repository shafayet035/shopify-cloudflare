/**
 * fetch() with a fresh Shopify session token attached. Session tokens live for
 * 60 seconds, so we ask App Bridge for a new one per request instead of caching.
 * Outside the Shopify admin (DEV_BYPASS_AUTH local mode) there is no App Bridge
 * global — we just send the request bare and the server's bypass handles it.
 *
 * A 401 with X-Shopify-Retry-Invalid-Session-Request means "the token aged
 * out mid-flight — get a fresh one and retry", which we do exactly once.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
	const response = await send(input, init);
	if (
		response.status === 401 &&
		response.headers.get("X-Shopify-Retry-Invalid-Session-Request") !== null
	) {
		return send(input, init);
	}
	return response;
}

async function send(input: string, init: RequestInit): Promise<Response> {
	const headers = new Headers(init.headers);
	if (typeof shopify !== "undefined" && shopify.idToken) {
		headers.set("Authorization", `Bearer ${await shopify.idToken()}`);
	}
	return fetch(input, { ...init, headers });
}

export async function authJson<T>(input: string, init: RequestInit = {}): Promise<T> {
	const response = await authFetch(input, init);
	if (!response.ok) {
		const body = await response.text();
		throw new Error(`${response.status} ${input}: ${body}`);
	}
	return response.json() as Promise<T>;
}
