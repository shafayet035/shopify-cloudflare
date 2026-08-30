import { Link, Outlet } from "react-router";

/** App chrome shared by every page. App Bridge renders ui-nav-menu as the admin's left-nav for the app. */
export function AppLayout() {
	return (
		<>
			<ui-nav-menu>
				<Link to="/" rel="home">
					Dashboard
				</Link>
				<Link to="/assets">Assets</Link>
				<Link to="/settings">Settings</Link>
			</ui-nav-menu>
			<Outlet />
		</>
	);
}
