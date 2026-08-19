import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// When running under `shopify app dev`, the CLI fronts this dev server with a
// cloudflared tunnel and passes the public tunnel URL as HOST. Vite's HMR
// websocket must then connect back through the tunnel (wss on 443) instead of
// ws://localhost:<port> — the same trick Shopify's own app templates use.
const tunnelUrl = process.env.HOST ?? process.env.APP_URL;
const tunnelHost =
	tunnelUrl && !tunnelUrl.includes("localhost") ? new URL(tunnelUrl).host : undefined;

export default defineConfig({
	plugins: [react(), cloudflare()],
	server: {
		// `shopify app dev` picks the port; plain `npm run dev` uses 5173.
		port: Number(process.env.PORT) || 5173,
		allowedHosts: true,
		hmr: tunnelHost
			? { protocol: "wss", host: tunnelHost, clientPort: 443 }
			: undefined,
	},
});
