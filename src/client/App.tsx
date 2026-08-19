import { BrowserRouter, Link, Route, Routes } from "react-router";
import Dashboard from "./pages/Dashboard";
import Assets from "./pages/Assets";
import Settings from "./pages/Settings";

export default function App() {
	return (
		<BrowserRouter>
			{/* App Bridge renders this as the admin's left-nav menu for the app */}
			<ui-nav-menu>
				<Link to="/" rel="home">
					Dashboard
				</Link>
				<Link to="/assets">Assets</Link>
				<Link to="/settings">Settings</Link>
			</ui-nav-menu>
			<Routes>
				<Route path="/" element={<Dashboard />} />
				<Route path="/assets" element={<Assets />} />
				<Route path="/settings" element={<Settings />} />
			</Routes>
		</BrowserRouter>
	);
}
