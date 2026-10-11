import { Navigate, Route, Routes } from "react-router-dom";
import { hasRole, useAuth } from "./auth.tsx";
import { Layout } from "./components/Layout.tsx";
import { SignInPage } from "./pages/SignInPage.tsx";
import { RostersPage } from "./pages/RostersPage.tsx";
import { UsersPage } from "./pages/UsersPage.tsx";

export function App() {
  const { user, loading, error } = useAuth();

  if (loading) return <div className="center-screen muted">Loading…</div>;
  if (error && !user) return <div className="center-screen">{error}</div>;
  if (!user) return <SignInPage />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<RostersPage />} />
        {hasRole(user, "admin") && <Route path="admin/users" element={<UsersPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
