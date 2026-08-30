import { AwsClient } from "aws4fetch";
import type { Env } from "../types";

const DOWNLOAD_URL_TTL_SECONDS = 300; // short — the DownloadGate already limits mint-rate

/** Content-Disposition value for a download, with quotes stripped from the name. */
export function attachmentDisposition(filename: string): string {
	return `attachment; filename="${filename.replaceAll('"', "")}"`;
}

export function presignConfigured(env: Env): boolean {
	return Boolean(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

/**
 * Presigned R2 GET URL (SigV4 via aws4fetch). The file then streams from R2
 * directly — the Worker never proxies the bytes. Notes:
 *  - presigned URLs only work on the S3 endpoint
 *    (https://{account}.r2.cloudflarestorage.com), not on custom domains, so
 *    buyers will see that hostname. If you want your own domain on download
 *    URLs, use the streaming fallback in routes/downloads.ts instead.
 *  - requires an R2 API token (dashboard > R2 > Manage API tokens) stored as
 *    the R2_* secrets. Without them the app falls back to streaming.
 */
export async function presignDownloadUrl(
	env: Env,
	r2Key: string,
	filename: string,
): Promise<string> {
	const client = new AwsClient({
		accessKeyId: env.R2_ACCESS_KEY_ID!,
		secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
	});

	const url = new URL(
		`https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}/${encodeURIComponent(r2Key).replaceAll("%2F", "/")}`,
	);
	url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_TTL_SECONDS));
	url.searchParams.set("response-content-disposition", attachmentDisposition(filename));

	const signed = await client.sign(new Request(url, { method: "GET" }), {
		aws: { signQuery: true, service: "s3", region: "auto" },
	});
	return signed.url;
}
