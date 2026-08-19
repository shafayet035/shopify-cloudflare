import type { EmailMessage, EmailProvider } from "./provider";
import type { Env } from "../types";

/** Plain fetch to the Resend API — no SDK needed. https://resend.com/docs/api-reference */
export class ResendProvider implements EmailProvider {
	constructor(private readonly env: Env) {}

	async send(message: EmailMessage): Promise<void> {
		if (!this.env.RESEND_API_KEY) {
			throw new Error(
				"RESEND_API_KEY is not set. Add it to .dev.vars (local) or `wrangler secret put RESEND_API_KEY` (production).",
			);
		}
		const response = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: this.env.EMAIL_FROM ?? "onboarding@resend.dev",
				to: message.to,
				subject: message.subject,
				html: message.html,
				text: message.text,
			}),
		});
		if (!response.ok) {
			throw new Error(`Resend API error ${response.status}: ${await response.text()}`);
		}
	}
}
