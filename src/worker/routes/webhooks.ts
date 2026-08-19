import { Hono } from "hono";
import { getShopify } from "../shopify/client";
import type { AppEnv } from "../types";

/**
 * Single endpoint for every webhook topic (shopify.app.toml points them all
 * here). The handler does exactly three things — verify, dedupe, enqueue — so
 * it always answers well inside Shopify's 5-second deadline. Business logic
 * lives in the queue consumer (src/worker/queue/consumer.ts).
 */
export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.post("/", async (c) => {
	const rawBody = await c.req.text();
	const shopify = getShopify(c.env);

	// HMAC-SHA256 of the raw body against X-Shopify-Hmac-Sha256. A 401 on
	// failure is mandatory — App Store review sends deliberately bad HMACs.
	const validation = await shopify.webhooks.validate({
		rawBody,
		rawRequest: c.req.raw,
	});
	if (!validation.valid) {
		return c.json({ error: "Invalid webhook signature" }, 401);
	}

	// Shopify delivers at-least-once; the per-shop coordinator drops repeats.
	const webhookId = c.req.header("X-Shopify-Webhook-Id") ?? crypto.randomUUID();
	const coordinator = c.env.SHOP_COORDINATOR.get(
		c.env.SHOP_COORDINATOR.idFromName(validation.domain),
	);
	if (await coordinator.seenWebhook(webhookId)) {
		return c.json({ ok: true, duplicate: true });
	}

	await c.env.JOBS.send({
		type: "webhook",
		topic: validation.topic,
		shop: validation.domain,
		webhookId,
		payload: JSON.parse(rawBody),
	});

	return c.json({ ok: true });
});
