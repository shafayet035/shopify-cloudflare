import {
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * One row per installed shop — the only table the auth layer needs.
 * `accessToken` is the permanent offline token from token exchange.
 */
export const shops = sqliteTable("shops", {
	shopDomain: text("shop_domain").primaryKey(),
	accessToken: text("access_token").notNull(),
	scope: text("scope").notNull().default(""),
	installedAt: integer("installed_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
	uninstalledAt: integer("uninstalled_at", { mode: "timestamp" }),
});

// ---------------------------------------------------------------------------
// Example domain for a digital-asset store. Delete-to-customize: these three
// tables plus queue/jobs/, email/templates.ts, and the /download route are the
// demo product — replace them with your own domain model.
// ---------------------------------------------------------------------------

/** A file a merchant uploaded to R2. */
export const assets = sqliteTable("assets", {
	id: text("id").primaryKey(), // crypto.randomUUID()
	shopDomain: text("shop_domain")
		.notNull()
		.references(() => shops.shopDomain),
	r2Key: text("r2_key").notNull(),
	filename: text("filename").notNull(),
	size: integer("size").notNull(),
	contentType: text("content_type").notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.$defaultFn(() => new Date()),
});

/** Which asset is delivered when which product is purchased. */
export const productAssets = sqliteTable(
	"product_assets",
	{
		shopDomain: text("shop_domain")
			.notNull()
			.references(() => shops.shopDomain),
		productId: text("product_id").notNull(),
		assetId: text("asset_id")
			.notNull()
			.references(() => assets.id),
	},
	(t) => [primaryKey({ columns: [t.shopDomain, t.productId, t.assetId] })],
);

/**
 * A buyer's right to download an asset, created by the orders/paid job.
 * `downloadsUsed` here is the admin-facing count; the atomic source of truth
 * during a grant's lifetime is the DownloadGate Durable Object.
 */
export const downloadGrants = sqliteTable(
	"download_grants",
	{
		token: text("token").primaryKey(), // crypto.randomUUID(), used in the download URL
		shopDomain: text("shop_domain")
			.notNull()
			.references(() => shops.shopDomain),
		orderId: text("order_id").notNull(),
		orderEmail: text("order_email").notNull(),
		assetId: text("asset_id")
			.notNull()
			.references(() => assets.id),
		maxDownloads: integer("max_downloads").notNull().default(5),
		downloadsUsed: integer("downloads_used").notNull().default(0),
		expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.$defaultFn(() => new Date()),
	},
	(t) => [uniqueIndex("grants_order_asset").on(t.orderId, t.assetId)],
);
