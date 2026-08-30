CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`shop_domain` text NOT NULL,
	`r2_key` text NOT NULL,
	`filename` text NOT NULL,
	`size` integer NOT NULL,
	`content_type` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_domain`) REFERENCES `shops`(`shop_domain`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_shop_created` ON `assets` (`shop_domain`,`created_at`);--> statement-breakpoint
CREATE TABLE `download_grants` (
	`token` text PRIMARY KEY NOT NULL,
	`shop_domain` text NOT NULL,
	`order_id` text NOT NULL,
	`order_email` text NOT NULL,
	`asset_id` text NOT NULL,
	`max_downloads` integer DEFAULT 5 NOT NULL,
	`downloads_used` integer DEFAULT 0 NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`shop_domain`) REFERENCES `shops`(`shop_domain`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grants_order_asset` ON `download_grants` (`order_id`,`asset_id`);--> statement-breakpoint
CREATE INDEX `grants_shop_created` ON `download_grants` (`shop_domain`,`created_at`);--> statement-breakpoint
CREATE INDEX `grants_asset` ON `download_grants` (`asset_id`);--> statement-breakpoint
CREATE TABLE `product_assets` (
	`shop_domain` text NOT NULL,
	`product_id` text NOT NULL,
	`asset_id` text NOT NULL,
	PRIMARY KEY(`shop_domain`, `product_id`, `asset_id`),
	FOREIGN KEY (`shop_domain`) REFERENCES `shops`(`shop_domain`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`asset_id`) REFERENCES `assets`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shops` (
	`shop_domain` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`installed_at` integer NOT NULL,
	`uninstalled_at` integer
);
