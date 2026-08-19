import type { Env } from "../src/worker/types";

declare module "cloudflare:test" {
	// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- module augmentation
	interface ProvidedEnv extends Env {}
}
