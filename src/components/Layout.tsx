import { Link, NavLink, Outlet } from "react-router-dom";
import { hasRole, useAuth } from "../auth.tsx";
import { ROLE_LABELS } from "../../shared/types.ts";

export function Layout() {
  const { user, signOut } = useAuth();

  function handleSignOut() {
    if (confirm("Sign out of Batter Beats on this phone?")) signOut();
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
      <div className="whoami muted">
        Signed in as <strong>{user!.username}</strong> · {ROLE_LABELS[user!.role]}
      </div>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
