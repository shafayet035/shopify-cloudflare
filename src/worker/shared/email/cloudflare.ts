import type { EmailMessage, EmailProvider } from "./provider";
import type { Env } from "../../types";

/**
 * Cloudflare Email Service (Workers Paid plan; 3,000 emails/mo included).
 * To enable: uncomment the send_email binding in wrangler.jsonc, onboard your
 * sending domain in the Cloudflare dashboard (Email > Email Service), set
 * EMAIL_PROVIDER=cloudflare and EMAIL_FROM to an address on that domain.
 * https://developers.cloudflare.com/email-service/
 */
export class CloudflareEmailProvider implements EmailProvider {
	constructor(private readonly env: Env) {}

	async send(message: EmailMessage): Promise<void> {
		if (!this.env.EMAIL) {
			throw new Error(
				"EMAIL_PROVIDER=cloudflare but the send_email binding is not configured — uncomment it in wrangler.jsonc and onboard a sending domain.",
			);
		}
		if (!this.env.EMAIL_FROM) {
			throw new Error("EMAIL_FROM must be set to an address on your onboarded sending domain.");
		}
		await this.env.EMAIL.send({
			from: this.env.EMAIL_FROM,
			to: message.to,
			subject: message.subject,
			html: message.html,
			text: message.text,
		});
	}
}
