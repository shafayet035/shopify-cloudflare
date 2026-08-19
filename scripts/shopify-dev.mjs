/**
 * Bridge between `shopify app dev` and the Cloudflare Vite plugin.
 *
 * The Shopify CLI injects credentials and the tunnel URL as process env vars,
 * but the Worker (running inside Vite's workerd) reads its secrets from
 * .dev.vars. This script copies the CLI-provided values into .dev.vars
 * (preserving any other lines you've added), then starts Vite on the port the
 * CLI expects. Used by shopify.web.toml's dev command.
 */
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const devVarsPath = join(root, ".dev.vars");

const injected = {
	SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY,
	SHOPIFY_API_SECRET: process.env.SHOPIFY_API_SECRET,
	SHOPIFY_APP_URL: process.env.HOST ?? process.env.APP_URL,
};

let existing = "";
try {
	existing = await readFile(devVarsPath, "utf8");
} catch {
	// no .dev.vars yet — we'll create it
}

const lines = existing.split("\n").filter((line) => {
	const key = line.split("=")[0]?.trim();
	return !(key in injected);
});
for (const [key, value] of Object.entries(injected)) {
	if (value) lines.push(`${key}=${value}`);
}
await writeFile(devVarsPath, lines.filter(Boolean).join("\n") + "\n");
console.log(`[shopify-dev] wrote ${Object.keys(injected).join(", ")} to .dev.vars`);

const child = spawn("npx", ["vite"], {
	cwd: root,
	stdio: "inherit",
	env: process.env, // PORT flows through to vite.config.ts
});
child.on("exit", (code) => process.exit(code ?? 0));
