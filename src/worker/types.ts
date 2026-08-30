import type { ShopCoordinator } from "./shared/ShopCoordinator";
import type { DownloadGate } from "./features/grants/DownloadGate";

/**
 * Everything the Worker receives from the platform. Bindings come from
 * wrangler.jsonc; secrets come from .dev.vars locally and `wrangler secret` in
 * production (see .dev.vars.example for the full list with instructions).
 */
export interface Env {
	// --- bindings (wrangler.jsonc) ---
	ASSETS: Fetcher;
	DB: D1Database;
	SHOP_COORDINATOR: DurableObjectNamespace<ShopCoordinator>;
	DOWNLOAD_GATE: DurableObjectNamespace<DownloadGate>;
	JOBS: Queue<JobMessage>;
	ASSETS_BUCKET: R2Bucket;
	/** Present only when the send_email binding is uncommented in wrangler.jsonc */
	EMAIL?: { send(message: EmailSendParams): Promise<void> };

	// --- vars (wrangler.jsonc) ---
	SHOPIFY_API_VERSION: string;
	EMAIL_PROVIDER: "console" | "resend" | "cloudflare";
	R2_BUCKET_NAME: string;

	// --- secrets ---
	SHOPIFY_API_KEY: string;
	SHOPIFY_API_SECRET: string;
	/** Public https URL of the deployed Worker, e.g. https://my-app.me.workers.dev */
	SHOPIFY_APP_URL: string;
	RESEND_API_KEY?: string;
	/** Sender address for transactional email, e.g. "Downloads <orders@yourdomain.com>" */
	EMAIL_FROM?: string;
	// R2 S3-API credentials — only needed for presigned download URLs. Without
	// them, downloads stream through the Worker instead (works out of the box).
	R2_ACCOUNT_ID?: string;
	R2_ACCESS_KEY_ID?: string;
	R2_SECRET_ACCESS_KEY?: string;
	/** Set to "1" in .dev.vars to develop the UI without a Shopify store (localhost only) */
	DEV_BYPASS_AUTH?: string;
}

/** Shape of the Cloudflare Email Service send() params (subset we use). */
export interface EmailSendParams {
	from: string;
	to: string;
	subject: string;
	html?: string;
	text?: string;
}

/** One message on the shopify-jobs queue. All webhooks funnel through here. */
export type JobMessage = {
	type: "webhook";
	topic: string;
	shop: string;
	webhookId: string;
	payload: unknown;
};

/** Set on the Hono context by the shopifyAuth middleware. */
export interface ShopContext {
	shop: string;
	accessToken: string;
	/** True only in DEV_BYPASS_AUTH local mode — there is no real store behind this context. */
	isDevBypass: boolean;
}

/** Hono generics used across all routes. */
export type AppEnv = {
	Bindings: Env;
	Variables: {
		shop: ShopContext;
	};
};
