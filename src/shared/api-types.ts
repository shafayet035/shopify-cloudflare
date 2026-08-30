/**
 * The API contract between the Worker and the React client. Both sides import
 * from here (single package — no monorepo needed), so field renames show up as
 * type errors on both ends instead of silent drift.
 *
 * Dates cross the wire as ISO strings (JSON.stringify serializes the Worker's
 * Date objects), so they are typed `string` here.
 */

export interface MeResponse {
	shop: string;
	shopName: string;
	assetCount: number;
	grantCount: number;
	totalDownloads: number;
}

export interface AssetSummary {
	id: string;
	filename: string;
	size: number;
	contentType: string;
	createdAt: string;
	/** Product IDs this asset is delivered for. */
	products: string[];
}

export interface GrantSummary {
	token: string;
	orderId: string;
	orderEmail: string;
	filename: string;
	maxDownloads: number;
	downloadsUsed: number;
	expiresAt: string;
	createdAt: string;
}

export interface BeginUploadResponse {
	assetId: string;
	key: string;
	uploadId: string;
}

export interface UploadPartResponse {
	partNumber: number;
	etag: string;
}
