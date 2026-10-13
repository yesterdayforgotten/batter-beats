import { Navigate, Route, Routes } from "react-router-dom";
import { hasRole, useAuth } from "./auth.tsx";
import { Layout, Plain } from "./components/Layout.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";
import { RostersPage } from "./pages/RostersPage.tsx";
import { GamePage } from "./pages/GamePage.tsx";
import { RosterEditPage } from "./pages/RosterEditPage.tsx";
import { PlayerEditPage } from "./pages/PlayerEditPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";
import { PlaylistEditPage, PlaylistsPage } from "./pages/PlaylistPage.tsx";
import { AdminPage } from "./pages/AdminPage.tsx";
import { MusicPage } from "./pages/MusicPage.tsx";
import { SyncBar } from "./components/SyncBar.tsx";

export function App() {
  const { user, loading, error } = useAuth();

  if (loading) return <div className="center-screen muted">Loading…</div>;
  if (error && !user) return <div className="center-screen">{error}</div>;
  if (!user) return <SignInPage />;

  const editor = hasRole(user, "editor");
  return (
    <>
      <SyncBar />
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<RostersPage />} />
          {hasRole(user, "admin") && <Route path="admin" element={<AdminPage />} />}
          {hasRole(user, "admin") && <Route path="admin/users" element={<UsersPage />} />}
        </Route>
        <Route element={<Plain />}>
          <Route path="rosters/:id" element={<GamePage />} />
          <Route path="playlists" element={<PlaylistsPage />} />
          <Route path="playlists/:id" element={<PlaylistEditPage />} />
          <Route path="playlist" element={<Navigate to="/playlists" replace />} />
          {editor && <Route path="music" element={<MusicPage />} />}
          {editor && <Route path="rosters/:id/edit" element={<RosterEditPage />} />}
          {editor && <Route path="players/:id" element={<PlayerEditPage />} />}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
