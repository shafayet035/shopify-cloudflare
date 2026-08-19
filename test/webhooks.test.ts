import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

async function shopifyHmac(body: string, secret: string): Promise<string> {
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

function webhookHeaders(hmac: string, webhookId: string): Record<string, string> {
	return {
		"Content-Type": "application/json",
		"X-Shopify-Hmac-Sha256": hmac,
		"X-Shopify-Topic": "orders/paid",
		"X-Shopify-Shop-Domain": "test-store.myshopify.com",
		"X-Shopify-Webhook-Id": webhookId,
		"X-Shopify-API-Version": "2026-07",
	};
}

describe("POST /webhooks", () => {
	it("rejects a bad HMAC with 401 (App Store review tests this)", async () => {
		const body = JSON.stringify({ id: 1 });
		const response = await SELF.fetch("https://test.example.com/webhooks", {
			method: "POST",
			headers: webhookHeaders("aW52YWxpZA==", "wh-1"),
			body,
		});
		expect(response.status).toBe(401);
	});

	it("accepts a valid HMAC", async () => {
		const body = JSON.stringify({ id: 2 });
		const response = await SELF.fetch("https://test.example.com/webhooks", {
			method: "POST",
			headers: webhookHeaders(await shopifyHmac(body, "test-secret"), "wh-2"),
			body,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("drops a duplicate webhook id", async () => {
		const body = JSON.stringify({ id: 3 });
		const headers = webhookHeaders(await shopifyHmac(body, "test-secret"), "wh-3");
		await SELF.fetch("https://test.example.com/webhooks", { method: "POST", headers, body });
		const second = await SELF.fetch("https://test.example.com/webhooks", {
			method: "POST",
			headers,
			body,
		});
		expect(await second.json()).toEqual({ ok: true, duplicate: true });
	});
});

describe("auth", () => {
	it("rejects /api requests without a session token", async () => {
		const response = await SELF.fetch("https://test.example.com/api/me");
		expect(response.status).toBe(401);
	});

	it("serves /api/health publicly (deploy smoke test)", async () => {
		const response = await SELF.fetch("https://test.example.com/api/health");
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});
});
