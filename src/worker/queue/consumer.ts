import { ensureDbReady } from "../db/bootstrap";
import { handleOrderPaid } from "./jobs/orderPaid";
import { handleAppUninstalled } from "./jobs/appUninstalled";
import { handleCompliance, COMPLIANCE_TOPICS } from "./jobs/compliance";
import type { Env, JobMessage } from "../types";

/**
 * Queue consumer — exported from src/worker/index.ts as the `queue` handler.
 * Each message acks or retries independently; after max_retries (wrangler.jsonc)
 * a message lands in the shopify-jobs-dlq dead-letter queue.
 */
export async function handleQueueBatch(
	batch: MessageBatch<JobMessage>,
	env: Env,
): Promise<void> {
	await ensureDbReady(env);

	for (const message of batch.messages) {
		try {
			await dispatch(message.body, env, message.attempts);
			message.ack();
		} catch (error) {
			console.error(
				`Job failed (topic=${message.body.topic}, shop=${message.body.shop}, attempt=${message.attempts}):`,
				error,
			);
			message.retry({ delaySeconds: 60 });
		}
	}
}

async function dispatch(job: JobMessage, env: Env, attempt: number): Promise<void> {
	// Note: @shopify/shopify-api normalizes topics to their GraphQL enum form —
	// "orders/paid" arrives here as "ORDERS_PAID".
	switch (job.topic) {
		case "ORDERS_PAID":
			return handleOrderPaid(env, job.shop, job.payload, attempt);
		case "APP_UNINSTALLED":
			return handleAppUninstalled(env, job.shop);
		default:
			if (COMPLIANCE_TOPICS.has(job.topic)) {
				return handleCompliance(env, job.topic, job.shop, job.payload);
			}
			// A topic you subscribed to in shopify.app.toml but haven't handled
			// yet — add a case above. Ack instead of retrying forever.
			console.warn(`No handler for webhook topic "${job.topic}" — ignoring`);
	}
}
