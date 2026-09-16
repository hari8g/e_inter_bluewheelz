import { Wrench } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { PageHeader } from "@/layout/AppShell";
import { Button } from "@/ui/Button";
import { Callout } from "@/ui/Callout";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Input, Select, Textarea } from "@/ui/Input";
import type { MaintenanceItem, Vehicle } from "@/types/api";

export default function Maintenance() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [items, setItems] = useState<MaintenanceItem[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [workType, setWorkType] = useState("Scheduled service");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [odo, setOdo] = useState<string>("");
  const [vendor, setVendor] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [v, m] = await Promise.all([api.vehicles(), api.maintenance()]);
    setVehicles(v);
    setItems(m);
    if (!vehicleId && v[0]) setVehicleId(v[0].id);
  }

  useEffect(() => {
    refresh().catch(() => undefined);
  }, []);

  useEffect(() => {
    const v = vehicles.find((x) => x.id === vehicleId);
    if (v?.trip?.endOdoKm != null) setOdo(String(Math.round(v.trip.endOdoKm)));
    else if (v) setOdo(String(Math.round(v.odometerKm)));
  }, [vehicleId, vehicles]);

  const vById = useMemo(() => Object.fromEntries(vehicles.map((x) => [x.id, x])), [vehicles]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.addMaintenance({
        vehicleId,
        workType,
        title,
        dueDate,
        odometerAtDueKm: odo === "" ? null : Number(odo),
        vendor: vendor || null,
        notes,
      });
      setTitle("");
      setNotes("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: MaintenanceItem["status"]) {
    await api.updateMaintenanceStatus(id, status);
    await refresh();
  }

  const open = items.filter((i) => i.status !== "done");

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Maintenance & service"
        description="Suggestions from GPS + trip ingest: Ace major service from odo, high idle investigation, GPS–report mismatch odometer audit. Prefill due odo from trip-end odometer. Predictive CAN is not a default work type for GPS-only vehicles."
      />
      <Callout icon={Wrench}>
        <span className="font-semibold text-ink">Operator note:</span> this is a lightweight work list for the command
        centre. e-inter models predictive hooks from CAN deltas — wire the same endpoints to your CMMS or workshop
        system when you are ready.
      </Callout>
      <Card className="mt-6">
        <form className="space-y-5" onSubmit={addItem}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Vehicle">
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} required>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registration} · {v.displayName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Work type">
              <Select value={workType} onChange={(e) => setWorkType(e.target.value)}>
                <option>Scheduled service</option>
                <option>Inspection</option>
                <option>Idling investigation</option>
                <option>Odometer audit</option>
                <option>Tyre & brake</option>
              </Select>
            </Field>
            <Field label="Title" hint="Short operator-facing label.">
              <Input
                placeholder="e.g. A-service, tyre rotation"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Field>
            <Field label="Due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </Field>
            <Field label="Odometer at due (optional, km)">
              <Input type="number" placeholder="—" value={odo} onChange={(e) => setOdo(e.target.value)} />
            </Field>
            <Field label="Vendor / bay (optional)">
              <Input value={vendor} onChange={(e) => setVendor(e.target.value)} />
            </Field>
          </div>
          <Field label="Notes">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              + Add work item
            </Button>
          </div>
        </form>
      </Card>
      <Card className="mt-8 overflow-x-auto p-0">
        <div className="border-b border-line px-6 py-4">
          <div className="text-sm font-semibold text-ink">Open & upcoming</div>
          <div className="text-xs text-ink-muted">Sorted by due date. Update status as jobs move.</div>
        </div>
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-6 py-3">Vehicle</th>
              <th className="px-6 py-3">Type</th>
              <th className="px-6 py-3">Title</th>
              <th className="px-6 py-3">Due</th>
              <th className="px-6 py-3">Odo</th>
              <th className="px-6 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {open.map((m) => (
              <tr key={m.id}>
                <td className="px-6 py-3 font-medium text-ink">
                  {vById[m.vehicleId]?.registration ?? m.vehicleId}
                </td>
                <td className="px-6 py-3 text-ink-muted">{m.workType}</td>
                <td className="px-6 py-3 text-ink">{m.title}</td>
                <td className="px-6 py-3 text-ink-muted">{m.dueDate}</td>
                <td className="px-6 py-3 text-ink-muted">{m.odometerAtDueKm ?? "—"}</td>
                <td className="px-6 py-3">
                  <Select
                    className="py-2 text-xs"
                    value={m.status}
                    onChange={(e) => setStatus(m.id, e.target.value as MaintenanceItem["status"])}
                  >
                    <option value="open">open</option>
                    <option value="in_progress">in_progress</option>
                    <option value="done">done</option>
                  </Select>
                </td>
              </tr>
            ))}
            {open.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-sm text-ink-muted">
                  No open items — fleet is clear.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
