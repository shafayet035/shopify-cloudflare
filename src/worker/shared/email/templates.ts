/**
 * Minimal transactional email templates as plain strings — dependency-free and
 * easy to replace (react-email + Resend is a nice upgrade path if you want
 * component-based templates).
 */

export interface DownloadLink {
	filename: string;
	url: string;
}

export function downloadEmail(params: {
	shopName: string;
	orderName: string;
	links: DownloadLink[];
	expiresAt: Date;
	maxDownloads: number;
}): { subject: string; html: string; text: string } {
	const { shopName, orderName, links, expiresAt, maxDownloads } = params;
	const expires = expiresAt.toISOString().slice(0, 10);

	const linksHtml = links
		.map(
			(l) =>
				`<li style="margin:8px 0"><a href="${l.url}" style="color:#2563eb">${escapeHtml(l.filename)}</a></li>`,
		)
		.join("");

	return {
		subject: `Your downloads from ${shopName} (order ${orderName})`,
		html: `<!doctype html>
<html><body style="font-family:system-ui,-apple-system,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px">
	<h2 style="font-size:18px">Thanks for your purchase from ${escapeHtml(shopName)}!</h2>
	<p>Your files for order <strong>${escapeHtml(orderName)}</strong> are ready:</p>
	<ul style="padding-left:20px">${linksHtml}</ul>
	<p style="color:#555;font-size:13px">
		Each link works up to ${maxDownloads} times and expires on ${expires}.
	</p>
</body></html>`,
		text: [
			`Thanks for your purchase from ${shopName}!`,
			`Your files for order ${orderName}:`,
			...links.map((l) => `- ${l.filename}: ${l.url}`),
			`Each link works up to ${maxDownloads} times and expires on ${expires}.`,
		].join("\n"),
	};
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
