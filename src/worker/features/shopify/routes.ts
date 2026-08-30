import { Hono } from "hono";
import { verifyWebhook } from "./index";
import type { AppEnv } from "../../types";

/**
 * Single endpoint for every webhook topic (shopify.app.toml points them all
 * here). The handler does exactly three things — verify, dedupe, enqueue — so
 * it always answers well inside Shopify's 5-second deadline. Business logic
 * lives in the queue consumer (src/worker/shared/queue.ts).
 */
export const webhookRoutes = new Hono<AppEnv>();

webhookRoutes.post("/", async (c) => {
	const rawBody = await c.req.text();

	const verified = await verifyWebhook(c.env, c.req.raw, rawBody);
	if (!verified) {
		return c.json({ error: "Invalid webhook signature" }, 401);
	}

	// Shopify delivers at-least-once; the per-shop coordinator drops repeats.
	const webhookId = c.req.header("X-Shopify-Webhook-Id") ?? crypto.randomUUID();
	const coordinator = c.env.SHOP_COORDINATOR.get(
		c.env.SHOP_COORDINATOR.idFromName(verified.shop),
	);
	if (await coordinator.seenWebhook(webhookId)) {
		return c.json({ ok: true, duplicate: true });
	}

	await c.env.JOBS.send({
		type: "webhook",
		topic: verified.topic,
		shop: verified.shop,
		webhookId,
		payload: JSON.parse(rawBody),
	});

	return c.json({ ok: true });
});
