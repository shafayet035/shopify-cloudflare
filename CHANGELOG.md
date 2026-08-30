# Changelog

All notable changes to this boilerplate are documented here, so you can see
what changed between the version you bought and the latest release.

## 1.0.0 — 2026-08-20

Initial release.

- Hono + Vite + React on Cloudflare Workers (`cloudflare/templates/vite-react-template` base)
- Token-exchange auth (managed installation, no OAuth redirect flow)
- D1 + Drizzle with self-applying migrations (Durable Object–locked runtime bootstrap)
- Webhooks: HMAC verification, per-shop dedup, Queues offload with DLQ
- Durable Objects: `ShopCoordinator` (dedup, locks, migration lock), `DownloadGate` (atomic download limits + expiry alarms)
- R2: multipart upload broker, presigned download URLs with Worker-streaming fallback
- Pluggable email: console (default) / Resend / Cloudflare Email Service
- Polaris web components UI + App Bridge, per-request CSP + API-key injection
- Theme app extension (instant-download badge)
- Mandatory compliance webhook handlers
- Vitest (Workers runtime) test suite, GitHub Actions CI
- `npm run setup` — post-clone personalization (app name + resource names)
- `npm run deploy` — build + deploy, then auto-sync `application_url` and the `SHOPIFY_APP_URL` secret from the deployed workers.dev URL (custom domains respected)

## 1.1.0 — 2026-08-20

- **Feature-module architecture**: worker code reorganized from technical
  layers into deep feature modules (`features/shopify`, `features/grants`,
  `features/assets`, `features/dashboard`) with `shared/` infrastructure.
- **Grant module deepened**: new interface `createForOrder()` / `redeem(token)`;
  `redeem` owns the delivery choice (presign vs stream) and is the single live
  writer of `downloads_used` (the DownloadGate alarm reconciles at expiry).
- **Asset module**: multipart upload, key layout, and delete cascade
  consolidated behind one interface; bad key access now returns 403 (was 500).
- **Shared API contract**: `src/shared/api-types.ts` imported by both Worker
  and client.
- Added `CONTEXT.md` (domain glossary) and `docs/adr/0001` (no repository layer).
- Tests: grants module covered through its interface (11 tests total).
