import { createBrowserRouter } from "react-router";
import { AppLayout } from "./layout/AppLayout";
import { Dashboard } from "./features/dashboard";
import { Assets } from "./features/assets";
import { Settings } from "./features/settings";

export const router = createBrowserRouter([
	{
		Component: AppLayout,
		children: [
			{ index: true, Component: Dashboard },
			{ path: "assets", Component: Assets },
			{ path: "settings", Component: Settings },
		],
	},
]);
