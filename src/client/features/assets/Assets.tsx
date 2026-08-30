import { useCallback, useEffect, useState } from "react";
import { authFetch, authJson } from "../../lib/authFetch";
import { useUpload } from "./_hooks/useUpload";
import type { AssetSummary } from "../../../shared/api-types";

export function Assets() {
	const [assets, setAssets] = useState<AssetSummary[]>([]);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(() => {
		authJson<{ assets: AssetSummary[] }>("/api/assets")
			.then((r) => setAssets(r.assets))
			.catch((e) => setError(String(e)));
	}, []);

	useEffect(reload, [reload]);

	const { upload, status, error: uploadError, fileInput, busy } = useUpload(reload);

	async function linkProduct(assetId: string) {
		const productId = window.prompt(
			"Numeric product ID to deliver this file for (Admin > Products > the number in the URL):",
		);
		if (!productId) return;
		await authJson(`/api/assets/${assetId}/links`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ productId }),
		});
		reload();
	}

	async function unlinkProduct(assetId: string, productId: string) {
		await authFetch(`/api/assets/${assetId}/links/${productId}`, { method: "DELETE" });
		reload();
	}

	async function remove(assetId: string) {
		if (!window.confirm("Delete this file and all of its download grants?")) return;
		await authFetch(`/api/assets/${assetId}`, { method: "DELETE" });
		reload();
	}

	return (
		<s-page heading="Assets">
			{(error ?? uploadError) && (
				<s-banner tone="critical" heading="Something went wrong">
					{error ?? uploadError}
				</s-banner>
			)}
			<s-section heading="Upload a file">
				<s-paragraph>
					Files upload straight to R2 in 10&nbsp;MB parts — no practical size limit.
				</s-paragraph>
				<input
					ref={fileInput}
					type="file"
					disabled={busy}
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void upload(file);
					}}
				/>
				{status && <s-text>{status}</s-text>}
			</s-section>
			<s-section heading="Your files">
				{assets.length === 0 ? (
					<s-paragraph>Nothing uploaded yet.</s-paragraph>
				) : (
					<s-table>
						<s-table-header-row>
							<s-table-header>File</s-table-header>
							<s-table-header>Size</s-table-header>
							<s-table-header>Delivered for products</s-table-header>
							<s-table-header>Actions</s-table-header>
						</s-table-header-row>
						<s-table-body>
							{assets.map((a) => (
								<s-table-row key={a.id}>
									<s-table-cell>{a.filename}</s-table-cell>
									<s-table-cell>{formatSize(a.size)}</s-table-cell>
									<s-table-cell>
										{a.products.length === 0 ? (
											<s-text tone="neutral">Not linked</s-text>
										) : (
											a.products.map((p) => (
												<s-clickable-chip
													key={p}
													accessibilityLabel={`Unlink product ${p}`}
													onClick={() => void unlinkProduct(a.id, p)}
												>{`${p} ✕`}</s-clickable-chip>
											))
										)}
									</s-table-cell>
									<s-table-cell>
										<s-button-group>
											<s-button onClick={() => void linkProduct(a.id)}>
												Link product
											</s-button>
											<s-button tone="critical" onClick={() => void remove(a.id)}>
												Delete
											</s-button>
										</s-button-group>
									</s-table-cell>
								</s-table-row>
							))}
						</s-table-body>
					</s-table>
				)}
			</s-section>
		</s-page>
	);
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
