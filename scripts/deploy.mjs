/**
 * Build + deploy, then keep the Shopify config in sync automatically.
 *
 * `npm run deploy` runs this. After `wrangler deploy` succeeds, the script
 * reads the deployed workers.dev URL from wrangler's output and:
 *   1. patches application_url / redirect_urls in shopify.app.toml
 *   2. uploads it as the SHOPIFY_APP_URL secret (the Worker needs it for
 *      token exchange and download links)
 *
 * A custom domain is respected: if application_url points at anything other
 * than *.workers.dev (and isn't the placeholder), nothing is touched.
 * Extra arguments are passed through to wrangler deploy.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tomlPath = join(root, "shopify.app.toml");

function run(command, args, { capture = false, input } = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: root,
			stdio: [input === undefined ? "inherit" : "pipe", capture ? "pipe" : "inherit", "inherit"],
		});
		let output = "";
		if (capture) {
			child.stdout.on("data", (chunk) => {
				output += chunk;
				process.stdout.write(chunk); // still show wrangler's output live
			});
		}
		if (input !== undefined) {
			child.stdin.write(input);
			child.stdin.end();
		}
		child.on("error", reject);
		child.on("exit", (code) =>
			code === 0 ? resolve(output) : reject(new Error(`${command} ${args[0]} exited with ${code}`)),
		);
	});
}

// 1. Build (client + worker), then deploy.
await run("npx", ["vite", "build"]);
const deployOutput = await run("npx", ["wrangler", "deploy", ...process.argv.slice(2)], {
	capture: true,
});

// 2. Find the deployed URL in wrangler's output.
const deployedUrl = deployOutput.match(/https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.workers\.dev/)?.[0];
if (!deployedUrl) {
	console.log("\n[deploy] Could not find a workers.dev URL in wrangler output — Shopify config left untouched.");
	process.exit(0);
}

// 3. Patch shopify.app.toml unless a custom domain is configured.
const toml = await readFile(tomlPath, "utf8");
const currentUrl = toml.match(/^application_url = "([^"]+)"/m)?.[1];
const isPlaceholder = currentUrl?.includes("YOUR-SUBDOMAIN");
const isWorkersDev = currentUrl !== undefined && new URL(currentUrl).host.endsWith(".workers.dev");

if (currentUrl && !isPlaceholder && !isWorkersDev) {
	console.log(`\n[deploy] application_url is a custom domain (${currentUrl}) — left untouched.`);
} else if (currentUrl && currentUrl !== deployedUrl) {
	await writeFile(tomlPath, toml.replaceAll(currentUrl, deployedUrl));
	console.log(`\n[deploy] shopify.app.toml: ${currentUrl} -> ${deployedUrl}`);
	console.log("[deploy] Run `shopify app deploy` to push the updated config to Shopify.");
} else {
	console.log(`\n[deploy] shopify.app.toml already points at ${deployedUrl}.`);
}

// 4. Keep the Worker's own SHOPIFY_APP_URL secret in sync (skipped for custom
// domains — set it yourself once with `wrangler secret put SHOPIFY_APP_URL`).
if (isPlaceholder || isWorkersDev || !currentUrl) {
	console.log(`[deploy] Setting SHOPIFY_APP_URL secret to ${deployedUrl}`);
	await run("npx", ["wrangler", "secret", "put", "SHOPIFY_APP_URL"], { input: deployedUrl });
}
