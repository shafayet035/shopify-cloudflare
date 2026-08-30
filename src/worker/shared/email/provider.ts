import { ResendProvider } from "./resend";
import { CloudflareEmailProvider } from "./cloudflare";
import type { Env } from "../../types";

export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	text?: string;
}

export interface EmailProvider {
	send(message: EmailMessage): Promise<void>;
}

/**
 * Selected by the EMAIL_PROVIDER var in wrangler.jsonc:
 *  - "console" (default): sends nothing — logs the email to the Worker logs.
 *    Lets the app run with zero email setup; switch providers when you're
 *    ready to deliver real mail.
 *  - "resend": free tier 3,000 emails/mo, one secret, no domain setup required
 *    to start (use their onboarding sender). https://resend.com
 *  - "cloudflare": Cloudflare Email Service via the send_email binding —
 *    requires the Workers Paid plan and a domain onboarded for sending.
 *
 * Using another service (Postmark, SES, Mailgun, ...)? Implement EmailProvider
 * (one send() method) and add a case below — nothing else in the app changes.
 */
export function getEmailProvider(env: Env): EmailProvider {
	switch (env.EMAIL_PROVIDER) {
		case "cloudflare":
			return new CloudflareEmailProvider(env);
		case "resend":
			return new ResendProvider(env);
		case "console":
		default:
			return new ConsoleEmailProvider();
	}
}

/** Logs instead of sending — the zero-setup default. */
class ConsoleEmailProvider implements EmailProvider {
	async send(message: EmailMessage): Promise<void> {
		console.log(
			`[email:console] to=${message.to} subject="${message.subject}"\n${message.text ?? message.html}`,
		);
	}
}
