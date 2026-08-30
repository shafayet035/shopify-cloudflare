import { useRef, useState } from "react";
import { authJson } from "../../../lib/authFetch";
import type { BeginUploadResponse, UploadPartResponse } from "../../../../shared/api-types";

const PART_SIZE = 10 * 1024 * 1024; // R2 multipart parts must be >= 5 MiB (except the last)

/**
 * The multipart upload state machine: create -> parts (with progress) ->
 * complete. Parts stream through the Worker to R2, so there's no practical
 * file-size limit and no R2 credentials in the browser.
 */
export function useUpload(onUploaded: () => void) {
	const [status, setStatus] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const fileInput = useRef<HTMLInputElement>(null);

	async function upload(file: File) {
		setError(null);
		setStatus(`Uploading ${file.name}…`);
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
				setStatus(`Uploading ${file.name}… ${Math.round(((i + 1) / totalParts) * 100)}%`);
			}

			// 3) complete
			await authJson(`/api/uploads/${assetId}/complete`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ key, uploadId, parts, filename: file.name, contentType: file.type }),
			});
			onUploaded();
		} catch (e) {
			setError(String(e));
		} finally {
			setStatus(null);
			if (fileInput.current) fileInput.current.value = "";
		}
	}

	return { upload, status, error, fileInput, busy: status !== null };
}
