import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: "./wrangler.jsonc" },
			miniflare: {
				// Test-only secrets (real ones live in .dev.vars / wrangler secret)
				bindings: {
					SHOPIFY_API_KEY: "test-key",
					SHOPIFY_API_SECRET: "test-secret",
					SHOPIFY_APP_URL: "https://test.example.com",
				},
			},
		}),
	],
});
