import { LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";

export default function Login() {
  const { user, ready, login } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from || "/";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (ready && user) return <Navigate to={from} replace />;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(username, password);
      nav(from, { replace: true });
    } catch (error) {
      setErr((error as Error).message || "Could not sign in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center overflow-hidden bg-white px-4 py-10">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-brand-muted/80 to-transparent" />
      <div className="relative w-full max-w-lg">
        <div className="mb-8 flex items-center justify-between gap-4 rounded-2xl border border-line bg-white px-5 py-4 shadow-card">
          <img
            src="/logos/bosch.jpeg"
            alt="Bosch"
            className="h-10 w-auto max-w-[46%] object-contain object-left sm:h-12"
          />
          <span className="hidden h-10 w-px bg-line sm:block" aria-hidden />
          <img
            src="/logos/bluwheelz.jpeg"
            alt="BluWheelz — Electrifying Logistics"
            className="h-16 w-auto max-w-[46%] object-contain object-right sm:h-20"
          />
        </div>

        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-ink">e-inter</div>
          <p className="mt-1 text-sm text-ink-muted">Bosch fleet operations for BluWheelz</p>
        </div>

        <Card className="p-6 sm:p-7">
          <div className="mb-5 flex items-start gap-2 text-sm text-ink-muted">
            <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <p>Sign in with your BluWheelz operator credentials to open the dashboard.</p>
          </div>
          <form className="space-y-4" onSubmit={onSubmit}>
            <Field label="Username">
              <Input
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </Field>
            <Field label="Password">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>
            {err ? (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</div>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy || !username || !password}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-6 text-center text-xs text-ink-faint">Bosch e-inter · BluWheelz electrifying logistics</p>
      </div>
    </div>
  );
}
