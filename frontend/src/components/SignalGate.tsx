import type { ReactNode } from "react";

export type SignalGateState = "available" | "pending" | "unavailable";

export function SignalGate({
  state,
  label,
  children,
}: {
  state: SignalGateState;
  label?: string;
  children?: ReactNode;
}) {
  if (state === "available") return <>{children}</>;
  if (state === "pending") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        {label ?? "Pending Intellicar validation — stored, not used for KPIs."}
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-line bg-surface-page px-4 py-3 text-sm text-ink-muted">
      {label ?? "Not exposed on this platform."}
    </div>
  );
}
