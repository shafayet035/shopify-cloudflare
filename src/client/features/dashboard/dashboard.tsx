import { useEffect, useState } from "react";
import { authJson } from "../../lib/auth-fetch";
import type { GrantSummary, MeResponse } from "../../../shared/api-types";

export function Dashboard() {
	const [me, setMe] = useState<MeResponse | null>(null);
	const [grants, setGrants] = useState<GrantSummary[]>([]);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		authJson<MeResponse>("/api/me").then(setMe).catch((e) => setError(String(e)));
		authJson<{ grants: GrantSummary[] }>("/api/grants")
			.then((r) => setGrants(r.grants))
			.catch(() => {});
	}, []);

	return (
		<s-page heading={me ? `Welcome, ${me.shopName}` : "Dashboard"}>
			{error && (
				<s-banner tone="critical" heading="Could not load shop data">
					{error}
				</s-banner>
			)}
			{!me && !error && <s-spinner accessibilityLabel="Loading" />}
			{me && (
				<s-section heading="At a glance">
					<s-stack direction="inline" gap="large">
						<s-box padding="base">
							<s-heading>{String(me.assetCount)}</s-heading>
							<s-text>Assets uploaded</s-text>
						</s-box>
						<s-box padding="base">
							<s-heading>{String(me.grantCount)}</s-heading>
							<s-text>Download grants</s-text>
						</s-box>
						<s-box padding="base">
							<s-heading>{String(me.totalDownloads)}</s-heading>
							<s-text>Files delivered</s-text>
						</s-box>
					</s-stack>
				</s-section>
			)}
			<s-section heading="Recent download grants">
				{grants.length === 0 ? (
					<s-paragraph>
						No grants yet. Upload an asset, link it to a product, and place a
						test order — the buyer gets an email with their download links.
					</s-paragraph>
				) : (
					<s-table>
						<s-table-header-row>
							<s-table-header>File</s-table-header>
							<s-table-header>Order</s-table-header>
							<s-table-header>Buyer</s-table-header>
							<s-table-header>Downloads</s-table-header>
							<s-table-header>Expires</s-table-header>
						</s-table-header-row>
						<s-table-body>
							{grants.map((g) => (
								<s-table-row key={g.token}>
									<s-table-cell>{g.filename}</s-table-cell>
									<s-table-cell>{g.orderId}</s-table-cell>
									<s-table-cell>{g.orderEmail}</s-table-cell>
									<s-table-cell>{`${g.downloadsUsed}/${g.maxDownloads}`}</s-table-cell>
									<s-table-cell>{new Date(g.expiresAt).toLocaleDateString()}</s-table-cell>
								</s-table-row>
							))}
						</s-table-body>
					</s-table>
				)}
			</s-section>
		</s-page>
	);
}
