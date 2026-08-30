export function Settings() {
	return (
		<s-page heading="Settings">
			<s-section heading="Email delivery">
				<s-paragraph>
					Download emails are sent with the provider set by the{" "}
					<code>EMAIL_PROVIDER</code> var in <code>wrangler.jsonc</code> —{" "}
					<strong>console</strong> (default: logs only), <strong>resend</strong>{" "}
					(free tier), <strong>cloudflare</strong> (Email Service binding), or
					your own service via the <code>EmailProvider</code> interface.
				</s-paragraph>
				<s-paragraph>
					Set <code>EMAIL_FROM</code> to a sender on your verified domain for
					production deliverability.
				</s-paragraph>
			</s-section>
			<s-section heading="Download limits">
				<s-paragraph>
					Grants currently allow <strong>5 downloads</strong> within{" "}
					<strong>30 days</strong> — change the constants at the top of{" "}
					<code>src/worker/features/grants/index.ts</code>, or promote them to a
					merchant-editable settings table as your first customization.
				</s-paragraph>
			</s-section>
			<s-section heading="Billing">
				<s-paragraph>
					This boilerplate ships without billing code. The zero-code path is
					Shopify App Pricing (plans configured in the Partner dashboard);
					see the note in <code>src/worker/features/shopify/index.ts</code>.
				</s-paragraph>
			</s-section>
		</s-page>
	);
}
