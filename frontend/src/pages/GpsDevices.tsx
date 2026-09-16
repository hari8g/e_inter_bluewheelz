import { Link2Off, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { PageHeader } from "@/layout/AppShell";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Input } from "@/ui/Input";
import type { GpsDevice, Vehicle } from "@/types/api";

export default function GpsDevices() {
  const [rows, setRows] = useState<GpsDevice[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [serial, setSerial] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const [devs, ve] = await Promise.all([api.devices(), api.vehicles()]);
    setRows(devs);
    setVehicles(ve);
  }

  useEffect(() => {
    refresh().catch(() => setRows([]));
  }, []);

  async function register() {
    setBusy(true);
    try {
      await api.registerDevice(serial || undefined);
      setSerial("");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function unpair(id: string) {
    await api.unpairDevice(id);
    await refresh();
  }

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="GPS data sources"
        description="File devices from Database/ GPS CSVs. Serial BLU-GPS-KA01AS… with point count, first/last fix, and last device / 12V. These are traces, not live paired two-wheelers."
      />
      <Card className="mb-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end">
          <div className="flex-1">
            <Field label="Serial number (optional)">
              <Input
                placeholder="ELITE-GPS-… auto if empty"
                value={serial}
                onChange={(e) => setSerial(e.target.value)}
              />
            </Field>
          </div>
          <Button className="md:self-stretch" onClick={register} disabled={busy}>
            <Plus className="h-4 w-4" />
            Register unit
          </Button>
        </div>
      </Card>
      <Card className="overflow-x-auto p-0">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-5 py-3">Device</th>
              <th className="px-5 py-3">Firmware</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Last seen</th>
              <th className="px-5 py-3">Points / span</th>
              <th className="px-5 py-3">Last batteries</th>
              <th className="px-5 py-3">Paired vehicle</th>
              <th className="px-5 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((d) => {
              const reg =
                d.pairedVehicleId && vehicles.find((v) => v.id === d.pairedVehicleId)?.registration;
              return (
                <tr key={d.id} className="bg-white">
                  <td className="px-5 py-4">
                    <div className="font-semibold text-brand">{d.serial}</div>
                    <div className="text-xs text-ink-faint">{d.id}</div>
                  </td>
                  <td className="px-5 py-4 text-ink-muted">{d.firmware}</td>
                  <td className="px-5 py-4">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                      {d.type === "CAN_GATEWAY" ? "CAN+GPS" : "GPS"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-ink-muted">
                    {new Intl.DateTimeFormat("en-IN", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    }).format(new Date(d.lastSeenAt))}
                  </td>
                  <td className="px-5 py-4 text-xs text-ink-muted">
                    {d.pointCount != null ? `${d.pointCount.toLocaleString("en-IN")} pts` : "—"}
                    {d.firstFixAt ? (
                      <>
                        <br />
                        {d.firstFixAt.slice(0, 10)} → {d.lastSeenAt.slice(0, 10)}
                      </>
                    ) : null}
                  </td>
                  <td className="px-5 py-4 text-xs text-ink-muted">
                    Dev {d.lastDeviceBatteryV ?? "—"} V
                    <br />
                    12V {d.lastAuxBatteryV ?? "—"} V
                  </td>
                  <td className="px-5 py-4">
                    {reg ? (
                      <span className="font-semibold text-ink">{reg}</span>
                    ) : (
                      <span className="text-ink-faint">Unpaired</span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <Button
                      variant="secondary"
                      className="py-1.5 text-xs"
                      onClick={() => unpair(d.id)}
                      type="button"
                    >
                      <Link2Off className="h-4 w-4" />
                      Unpair
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
