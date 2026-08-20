/**
 * One-time project setup: personalizes the boilerplate after cloning.
 *
 *   npm run setup                 # interactive
 *   npm run setup -- "Acme Files" # non-interactive
 *
 * Renames the app + every Cloudflare resource (worker, D1, R2, queues) from
 * the boilerplate defaults to names derived from YOUR app name, and creates
 * .dev.vars from the example. Safe to run only once, right after cloning —
 * it replaces the known default names, so rerunning after manual renames
 * will find nothing to change.
 */
import { readFile, writeFile, copyFile, access, rename } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// The boilerplate's default names, as shipped. Each maps to a template of the
// new name derived from the chosen slug.
const RENAMES = (slug) => [
	["shopify-cloudflare-app", slug], // worker name
	["shopify-app-db", `${slug}-db`], // D1 database
	["shopify-digital-assets", `${slug}-assets`], // R2 bucket (+ R2_BUCKET_NAME var)
	["shopify-jobs-dlq", `${slug}-jobs-dlq`], // dead-letter queue (before shopify-jobs!)
	["shopify-jobs", `${slug}-jobs`], // queue
	["digital-assets-app", slug], // shopify.app.toml name/handle
	["shopify-cloudflare-boilerplate", slug], // package.json name
];

const FILES = ["wrangler.jsonc", "shopify.app.toml", "package.json", "index.html"];

function slugify(name) {
	return name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 54); // leave room for suffixes like -jobs-dlq within CF's 63-char limits
}

let appName = process.argv[2];
if (!appName) {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	appName = (await rl.question("App name (e.g. \"Acme Digital Files\"): ")).trim();
	rl.close();
}
if (!appName) {
	console.error("No app name given — nothing changed.");
	process.exit(1);
}

const slug = slugify(appName);
if (!slug) {
	console.error(`Could not derive a valid slug from "${appName}" — nothing changed.`);
	process.exit(1);
}

console.log(`\nApp name: ${appName}\nSlug:     ${slug}\n`);

let changedAnything = false;
for (const file of FILES) {
	const path = join(root, file);
	const before = await readFile(path, "utf8");
	let after = before;
	for (const [from, to] of RENAMES(slug)) {
		after = after.replaceAll(from, to);
	}
	// The human-readable name (not the slug) in the app config and page title.
	if (file === "shopify.app.toml") {
		after = after.replace(/^name = ".*"$/m, `name = "${appName}"`);
	}
	if (file === "index.html") {
		after = after.replace(/<title>.*<\/title>/, `<title>${appName}</title>`);
	}
	if (after !== before) {
		await writeFile(path, after);
		console.log(`  updated ${file}`);
		changedAnything = true;
	}
}

// Theme app extension: rename before the first `shopify app deploy` (renaming
// a deployed extension registers a brand-new one, so setup is the safe moment).
const oldExtDir = join(root, "extensions", "digital-delivery");
try {
	await access(oldExtDir);
	const extToml = join(oldExtDir, "shopify.extension.toml");
	const before = await readFile(extToml, "utf8");
	const after = before.replaceAll("digital-delivery", `${slug}-delivery`);
	if (after !== before) {
		await writeFile(extToml, after);
		await rename(oldExtDir, join(root, "extensions", `${slug}-delivery`));
		console.log(`  renamed extensions/digital-delivery -> extensions/${slug}-delivery`);
		changedAnything = true;
	}
} catch {
	// already renamed (or removed) — nothing to do
}

if (!changedAnything) {
	console.log("  nothing to change — already personalized (setup runs once, after cloning).");
}

// Create .dev.vars from the example so local dev works immediately.
try {
	await access(join(root, ".dev.vars"));
	console.log("  .dev.vars already exists — left untouched");
} catch {
	await copyFile(join(root, ".dev.vars.example"), join(root, ".dev.vars"));
	console.log("  created .dev.vars from .dev.vars.example");
}

console.log(`
Next steps:
  1. Fill in the REQUIRED values in .dev.vars (Shopify key/secret/app URL)
  2. npm run dev            # local UI (add DEV_BYPASS_AUTH="1" to .dev.vars)
  3. npm run deploy         # deploy to Cloudflare (auto-provisions D1 + R2)
  4. shopify app config link && shopify app deploy
`);
