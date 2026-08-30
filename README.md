# Shopify × Cloudflare Boilerplate

**Ship a Shopify app for $5/month.** A production-grade boilerplate for Shopify
embedded apps running entirely on Cloudflare Workers — with a complete
digital-asset delivery app included as the working example.

- **Hono + Vite + React** — one Worker serves the API and the embedded admin UI
- **Token-exchange auth** — no OAuth redirect dance, no session cookies; ~1 file
- **D1 + Drizzle** — typed schema, and the database migrates *itself* on deploy
- **Queues** — webhooks are verified, deduped, and processed in the background
- **Durable Objects** — atomic download limits and per-shop coordination
- **R2** — unlimited-size uploads, secure expiring download links, zero egress fees
- **Email** — pluggable provider: console (zero setup), Resend (free tier), Cloudflare Email Service, or your own service in ~5 lines
- **Theme app extension** — storefront block, managed by the Shopify CLI

## The $5 story (honest version)

Everything here runs on Cloudflare's **$5/month Workers Paid plan** — and most
of it runs on the **free plan** while you build:

| | Free plan | Workers Paid ($5/mo) |
|---|---|---|
| Worker requests | 100k/day | 10M/mo included |
| D1 database | 5 GB, 5M reads/day | 25B reads/mo included |
| Durable Objects (SQLite) | ✅ 100k req/day | 1M req/mo included |
| Queues | ✅ ~3,300 msgs/day | 1M ops/mo included |
| R2 storage | 10 GB free, **egress always free** | same + $0.015/GB after |
| Static assets (your UI) | free, unlimited | free, unlimited |
| Cloudflare Email Service | ✗ | 3,000 emails/mo included |

Email on the free plan? Use the default **Resend** provider (3,000 emails/mo
free on their side). Compare that to a $20–50/mo VPS or PaaS dyno.

## What the example app does

Merchants upload files, link them to products, and buyers automatically get an
email with secure download links when they pay:

```
orders/paid webhook ──▶ verify HMAC ──▶ dedupe ──▶ Queue
                                                    │
                          Durable Object            ▼
buyer clicks link ──▶  (atomic limit check) ◀── create grants + send email
        │
        ▼
  302 to presigned R2 URL (or stream through the Worker)
```

The example domain is deliberately thin and marked **delete-to-customize**
throughout — replace it with your own app in an afternoon.

---

## Quickstart

### Prerequisites

1. A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free plan is fine to start)
2. A [Shopify Partner account](https://partners.shopify.com) + a development store
3. Node.js 22+, and the Shopify CLI: `npm install -g @shopify/cli`

### 0. Make it yours (one time)

```bash
npm install
npm run setup                     # asks for your app name, renames the worker,
                                  # D1/R2/queue resources, and creates .dev.vars
```

### A. Deploy in 3 commands

Fill in the REQUIRED values in `.dev.vars` (Shopify key/secret), upload them,
and deploy — in this order, because `npm run deploy` finishes by setting the
correct `SHOPIFY_APP_URL` for you:

```bash
npx wrangler secret bulk .dev.vars
```

```bash
npm run deploy                    # builds + deploys; auto-provisions D1 and R2
```

Then connect Shopify:

```bash
shopify app config link           # connect to your Partner-dashboard app
```

```bash
shopify app deploy                # pushes scopes, webhooks, theme extension
```

`npm run deploy` also syncs your app URL automatically: it reads the deployed
`*.workers.dev` URL from wrangler's output, patches `application_url` /
`redirect_urls` in `shopify.app.toml`, and sets the Worker's `SHOPIFY_APP_URL`
secret (custom domains are detected and left alone). The database schema
applies itself on the first request — check
`https://<your-worker>.workers.dev/api/health` returns `{"ok":true}` and you're
live. Install the app on your dev store from the Partner dashboard.

> If your account asks for it, create the two queues once (their names are in
> `wrangler.jsonc` under `queues`): `npx wrangler queues create <name>`

### B. Git-connected deploys (optional)

Push your copy to your own GitHub repo and connect it in the Cloudflare
dashboard (Workers > your worker > Builds) — every push deploys, PRs get
preview URLs. Works with private repos.

---

## Local development

**UI-only mode** — no Shopify store needed:

```bash
echo 'DEV_BYPASS_AUTH="1"' >> .dev.vars
npm run dev
```

Open http://localhost:5173. The Worker runs in workerd locally with emulated
D1/DO/R2/Queues (state persists in `.wrangler/`). The bypass only works on
localhost and fabricates a `dev-shop.myshopify.com` context.

**Embedded mode** — the real thing, inside your dev store's admin:

```bash
npm run shopify:dev
```

The Shopify CLI opens a tunnel, injects your app credentials into `.dev.vars`,
and updates your app URLs automatically (see `scripts/shopify-dev.mjs`).

**Testing:** `npm test` runs [Vitest inside the Workers runtime](https://developers.cloudflare.com/workers/testing/vitest-integration/) —
webhook HMAC, auth, download-gate, and migration tests included.

---

## Architecture tour

The code is organized by **feature module**, not by technical layer. Each
feature folder is a deep module: `index.ts` is the interface, `routes.ts` the
thin HTTP mapping, everything else implementation. `CONTEXT.md` holds the
domain glossary; `docs/adr/` records design decisions.

| Path | What it is |
|---|---|
| `src/worker/index.ts` | Hono assembly, queue export, HTML shell (CSP + App Bridge meta injection) |
| `src/worker/features/shopify/` | The platform module: session-token auth + token exchange, Admin GraphQL, webhook verification, lifecycle jobs |
| `src/worker/features/grants/` | The Grant module: `createForOrder()` + `redeem(token)`, with the `DownloadGate` DO as an internal seam |
| `src/worker/features/assets/` | The Asset module: multipart uploads to R2, product links, delete cascade |
| `src/worker/features/dashboard/` | `/api/me` — the stats the Dashboard page shows |
| `src/worker/shared/` | Infrastructure: Drizzle schema + **self-applying migrations**, queue consumer, email providers, `ShopCoordinator` DO, R2 presigning |
| `src/shared/api-types.ts` | The API contract — imported by both Worker and client, so field drift is a type error |
| `src/client/` | React SPA (feature folders) with Polaris **web components** + App Bridge from Shopify's CDN |
| `extensions/` | Theme app extension (storefront blocks) |

### Auth: token exchange, not OAuth

Embedded apps no longer need the OAuth redirect flow. Shopify installs the app
with the scopes declared in `shopify.app.toml` (*managed installation*), and
every request from the embedded UI carries a 60-second session token. The
middleware in `src/worker/features/shopify/index.ts` verifies it and — when needed —
exchanges it for a permanent offline token stored in D1 (one row per shop).
That's the whole auth model.

### Self-applying migrations

There is **no migration CLI step**. Migration SQL (generated by drizzle-kit,
committed in `migrations/`) is bundled into the Worker; on the first request
after a deploy, a globally-unique Durable Object applies pending migrations
exactly once, no matter how many isolates race. Change the schema like this:

```bash
# 1. edit src/worker/shared/db/schema.ts
npm run db:generate   # drizzle-kit generate + bundle into the Worker
npm run deploy
```

Don't also run `wrangler d1 migrations apply` — the runtime bootstrap is the
canonical mechanism and they track state separately.

### Webhooks

All topics point at `POST /webhooks`. The handler verifies the HMAC (401 on
failure — App Store review tests this), dedupes by webhook id, enqueues, and
returns within milliseconds. Topics arrive in the consumer normalized to
GraphQL-enum form (`ORDERS_PAID`). The three mandatory compliance topics are
subscribed and handled in `src/worker/features/shopify/jobs.ts` — review those
handlers before you submit to the App Store.

### Downloads

`GET /download/:token` → D1 grant lookup → `DownloadGate.authorize()` (atomic,
race-proof) → delivery:

- **With R2 credentials set** (recommended): 302 to a 5-minute presigned R2 URL —
  the file streams from R2 directly, costing your Worker nothing. Note:
  presigned URLs use the `<account>.r2.cloudflarestorage.com` hostname.
- **Without them**: the Worker streams the file itself. Zero setup, fine for
  smaller files.

## Make it yours

Delete-to-customize checklist — the example domain is isolated to:

1. `src/worker/features/grants/` and `src/worker/features/assets/` — replace
   with your own feature modules (same shape: `index.ts` interface,
   `routes.ts` HTTP mapping)
2. `src/worker/shared/db/schema.ts` — the three tables below `shops`
3. `src/worker/shared/email/templates.ts` and `src/shared/api-types.ts`
4. `src/client/features/` — the example pages
5. `extensions/digital-delivery/` — the storefront badge

Keep: `features/shopify/`, `shared/` (queue consumer, migration bootstrap,
email providers, `ShopCoordinator`), and the HTML shell. Then:

- Naming is handled by `npm run setup` (worker, D1, R2, queues, app name/handle)
- Adjust `[access_scopes]` to what your app actually needs
- **Billing:** use [Shopify App Pricing](https://shopify.dev/docs/apps/launch/billing/shopify-app-pricing)
  (zero code, configured in the Partner dashboard); a programmatic example is
  commented in `src/worker/features/shopify/index.ts`

## Gotchas & FAQ

- **Session tokens live 60 seconds** — always fetch them per request
  (`src/client/lib/authFetch.ts` does this).
- **The CSP header matters**: embedded apps must send
  `frame-ancestors https://<shop> https://admin.shopify.com`. The Worker's HTML
  shell does this per request — that's why `run_worker_first` is configured.
- **D1 is single-region** (with optional read replication in beta). For a
  per-merchant app this is a non-issue; heavy read fan-out can enable replication.
- **Email ships in "console" mode** (logs instead of sending) so nothing is
  required to run. For real delivery set `EMAIL_PROVIDER=resend` (+
  `RESEND_API_KEY`), or `cloudflare` (Email Service is beta, paid-only, needs
  domain onboarding), or implement the 5-line `EmailProvider` interface for
  Postmark/SES/anything else.
- **Shopify API version** is a var (`SHOPIFY_API_VERSION`) — bump it quarterly.
- **Protected customer data**: reading order emails requires requesting
  protected customer data access in the Partner dashboard before App Store
  submission.

## License

Commercial license — see [LICENSE.md](LICENSE.md). You can build unlimited apps
with it; you can't resell the boilerplate itself.
