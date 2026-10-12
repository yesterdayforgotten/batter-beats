import { Link, NavLink, Outlet } from "react-router-dom";
import { hasRole, useAuth } from "../auth.tsx";
import { ROLE_LABELS } from "../../shared/types.ts";
import { AppVersion } from "./AppVersion.tsx";

/** Frame for the top-level screens (rosters, users). */
export function Layout() {
  const { user, signOut } = useAuth();

  function handleSignOut() {
    if (confirm("Sign out of Batter Beats on this phone? Teams saved for offline use are removed from it too.")) signOut();
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          Batter Beats
        </Link>
        <nav className="topnav">
          {hasRole(user, "admin") && <NavLink to="/admin/users">Users</NavLink>}
          <button className="link-button" onClick={handleSignOut}>
            Sign out
          </button>
        </nav>
      </header>
      <Outlet />
      <footer className="faint small" style={{ marginTop: 28, textAlign: "center" }}>
        {user!.username} · {ROLE_LABELS[user!.role]}
        <AppVersion />
      </footer>
    </div>
  );
}

/** Frame for inner screens, which bring their own header with a back button. */
export function Plain() {
  return (
    <div className="app">
      <Outlet />
    </div>
  );
}
