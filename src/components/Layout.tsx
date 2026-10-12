import { Link, Outlet } from "react-router-dom";
import { hasRole, useAuth } from "../auth.tsx";
import { ROLE_LABELS } from "../../shared/types.ts";
import { AppVersion } from "./AppVersion.tsx";
import { MenuIcon } from "./Icons.tsx";
import { MoreMenu } from "./MoreMenu.tsx";

/** Frame for the top-level screens (rosters, users). */
export function Layout() {
  const { user } = useAuth();

  return (
    <div className="app">
      <TopBar />
      <Outlet />
      <footer className="faint small" style={{ marginTop: 28, textAlign: "center" }}>
        {user!.username} · {ROLE_LABELS[user!.role]}
        <AppVersion />
      </footer>
    </div>
  );
}

/** Frame for inner screens: the app's top bar, then the screen's own header with a back button. */
export function Plain() {
  return (
    <div className="app">
      <TopBar />
      <Outlet />
    </div>
  );
}

/** The app's top bar on every screen: icon and name (back to Teams), and the ☰ menu. */
function TopBar() {
  const { user, signOut } = useAuth();

  function handleSignOut() {
    if (confirm("Sign out of Batter Beats on this phone? Teams saved for offline use are removed from it too.")) signOut();
  }

  return (
    <header className="topbar">
      <Link to="/" className="brand">
        <img src="/favicon.svg?v=7" alt="" width={28} height={28} />
        Batter Beats
      </Link>
      <MoreMenu
        icon={<MenuIcon />}
        label="Menu"
        items={[
          { label: "Playlists", to: "/playlists" },
          ...(hasRole(user, "editor") ? [{ label: "Music", to: "/music" }] : []),
          ...(hasRole(user, "admin") ? [{ label: "Admin", to: "/admin" }] : []),
          { label: "Sign out", onSelect: handleSignOut },
        ]}
      />
    </header>
  );
}
