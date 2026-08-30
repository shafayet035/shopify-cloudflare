# Domain glossary

The vocabulary this codebase is written in. Feature modules live in
`src/worker/features/<name>/` — each is a deep module: `index.ts` is the
interface, `routes.ts` the thin HTTP mapping, everything else implementation.

- **Shop**: an installed store, identified by its permanent `*.myshopify.com`
  domain. One D1 row holding the offline access token from token exchange.
- **Asset**: a file a merchant uploaded to R2, owned by the `assets` module.
  The R2 key layout `assets/{shop}/{assetId}/{filename}` is private to it;
  cross-module cleanup goes through `removeAllForShop()` / `removeAsset()`.
- **Product link**: merchant configuration ("purchasing product X delivers
  asset Y"), managed by the `assets` module.
- **Grant**: a buyer's right to download one asset, created by a paid order.
  Owned by the `grants` module — primary interface `createForOrder()` +
  `redeem()`, plus admin/cascade calls (`listForShop`, `statsForShop`,
  `removeForAsset`, `removeAllForShop`, `redactEmail`). Other modules touch
  grant data only through these.
- **Redemption**: the outcome of spending a grant download: `redirect`
  (presigned R2 URL), `stream` (through the Worker), or `denied`.
- **DownloadGate**: internal seam of the `grants` module — a Durable Object
  per grant token that atomically enforces the download limit. `redeem()` is
  the single live writer of `downloadsUsed`; the gate's expiry alarm is the
  reconciler.
- **ShopCoordinator**: infrastructure DO (per shop + one global instance):
  webhook dedup, named locks, and the D1 migration lock.
- **Job**: one queue message, always a verified webhook; topics use the
  library-normalized GraphQL enum form (`ORDERS_PAID`).
- **API contract**: request/response types in `src/shared/api-types.ts`,
  imported by both the Worker and the React client (no zod — see ADR-0001).
