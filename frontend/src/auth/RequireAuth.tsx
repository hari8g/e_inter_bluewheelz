import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

export function RequireAuth() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return <div className="p-8 text-sm text-ink-muted">Checking session…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
