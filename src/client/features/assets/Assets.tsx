import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch, authJson } from "../../lib/authFetch";
import type {
	AssetSummary,
	BeginUploadResponse,
	UploadPartResponse,
} from "../../../shared/api-types";

const PART_SIZE = 10 * 1024 * 1024; // R2 multipart parts must be >= 5 MiB (except the last)

export default function Assets() {
	const [assets, setAssets] = useState<AssetSummary[]>([]);
	const [uploading, setUploading] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	const reload = useCallback(() => {
		authJson<{ assets: AssetSummary[] }>("/api/assets")
			.then((r) => setAssets(r.assets))
			.catch((e) => setError(String(e)));
	}, []);

	useEffect(reload, [reload]);

	async function upload(file: File) {
		setError(null);
		setUploading(`Uploading ${file.name}…`);
		try {
			// 1) create the multipart upload
			const { assetId, key, uploadId } = await authJson<BeginUploadResponse>("/api/uploads", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ filename: file.name, contentType: file.type }),
			});

			// 2) send the parts through the Worker
			const parts: UploadPartResponse[] = [];
			const totalParts = Math.max(1, Math.ceil(file.size / PART_SIZE));
			for (let i = 0; i < totalParts; i++) {
				const chunk = file.slice(i * PART_SIZE, (i + 1) * PART_SIZE);
				const query = new URLSearchParams({ key, uploadId });
				const part = await authJson<UploadPartResponse>(
					`/api/uploads/${assetId}/parts/${i + 1}?${query}`,
					{ method: "PUT", body: chunk },
				);
				parts.push(part);
				setUploading(`Uploading ${file.name}… ${Math.round(((i + 1) / totalParts) * 100)}%`);
			}

			// 3) complete
			await authJson(`/api/uploads/${assetId}/complete`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, uploadId, parts, filename: file.name, contentType: file.type }),
			});
			reload();
		} catch (e) {
			setError(String(e));
		} finally {
			setUploading(null);
			if (fileInput.current) fileInput.current.value = "";
		}
	}

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
			{error && (
				<s-banner tone="critical" heading="Something went wrong">
					{error}
				</s-banner>
			)}
			<s-section heading="Upload a file">
				<s-paragraph>
					Files upload straight to R2 in 10&nbsp;MB parts — no practical size limit.
				</s-paragraph>
				<input
					ref={fileInput}
					type="file"
					disabled={uploading !== null}
					onChange={(e) => {
						const file = e.target.files?.[0];
						if (file) void upload(file);
					}}
				/>
				{uploading && <s-text>{uploading}</s-text>}
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
