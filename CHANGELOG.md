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
