import { Hono } from "hono";
import { getDashboard } from "./index";
import type { AppEnv } from "../../types";

/** /api/me — thin HTTP mapping over the Dashboard module. Mounted behind shopifyAuth. */
export const dashboardRoutes = new Hono<AppEnv>();

dashboardRoutes.get("/me", async (c) => {
	return c.json(await getDashboard(c.env, c.get("shop")));
});
