import { Bike, Info } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { OemPlatform } from "@/types/api";
import { PageHeader } from "@/layout/AppShell";
import { Button } from "@/ui/Button";
import { Callout } from "@/ui/Callout";
import { Card } from "@/ui/Card";
import { Field } from "@/ui/Field";
import { Input, Select } from "@/ui/Input";

export default function AddVehicle() {
  const nav = useNavigate();
  const [telemetryMode, setTelemetryMode] = useState<"gps_only" | "can_gps">("gps_only");
  const [oemPlatform, setOemPlatform] = useState<OemPlatform | "">("tata_ace_ev");
  const [nominalAh, setNominalAh] = useState(200);
  const [registration, setRegistration] = useState("KA01EV9001");
  const [displayName, setDisplayName] = useState("");
  const [model, setModel] = useState("Tata Ace EV");
  const [allowImmobilise, setAllowImmobilise] = useState(true);
  const [seedLat, setSeedLat] = useState(12.97);
  const [seedLng, setSeedLng] = useState(77.59);
  const [kwhPack, setKwhPack] = useState(3.2);
  const [odometerKm, setOdometerKm] = useState(0);
  const [socPercent, setSocPercent] = useState(82);
  const [locationLabel, setLocationLabel] = useState("Depot — Bengaluru");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [fileFleet, setFileFleet] = useState(false);

  useEffect(() => {
    setMsg(null);
  }, [telemetryMode]);

  useEffect(() => {
    api
      .commandCenter()
      .then((d) => setFileFleet(Boolean(d.dataSource?.startsWith("file:"))))
      .catch(() => setFileFleet(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api.registerVehicle({
        registration,
        displayName: displayName || registration,
        model,
        telemetryMode,
        allowImmobilise,
        seedLat,
        seedLng,
        kwhPack,
        oemPlatform: oemPlatform || undefined,
        nominalCapacityAh: oemPlatform === "eicher_ev" ? nominalAh : undefined,
        odometerKm,
        socPercent,
        locationLabel,
      });
      nav("/");
    } catch (er) {
      setMsg((er as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Register vehicle"
        description="e-inter extends e-lite with selectable telematics: GPS-only field units or CAN+GPS gateways for pack-level analytics and predictive maintenance."
      />
      {fileFleet ? (
        <Callout icon={Info}>
          <span className="font-semibold text-ink">File fleet is loaded from Database/</span> — GPS CSVs and the BluWheelz
          trip workbook already populate command centre, telemetry, and analytics. New vehicles default to GPS-only.
          Do not assume CAN+GPS unless a gateway is actually fitted.
        </Callout>
      ) : (
      <Callout icon={Info}>
        <span className="font-semibold text-ink">Telematics profile</span> — Choose{" "}
        <span className="font-medium">CAN + GPS</span> when a gateway is wired to the BMS/inverter. The command centre
        unlocks motor temperature, cell spread, and health scores. GPS-only remains fully supported for lightweight
        deployments.
      </Callout>
      )}
      <Card className="mt-6">
        <form className="space-y-6" onSubmit={onSubmit}>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Telematics mode">
              <Select
                value={telemetryMode}
                onChange={(e) => setTelemetryMode(e.target.value as "gps_only" | "can_gps")}
              >
                <option value="gps_only">GPS-only (cellular GPS module)</option>
                <option value="can_gps">CAN + GPS gateway</option>
              </Select>
            </Field>
            <Field label="Registration">
              <Input value={registration} onChange={(e) => setRegistration(e.target.value)} required />
            </Field>
            <Field label="Display name">
              <Input
                placeholder="e.g. Depot north lead"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
            <Field label="OEM platform" hint="Required for live Intellicar ingest. Drives capability gating.">
              <Select
                value={oemPlatform}
                onChange={(e) => {
                  const p = e.target.value as OemPlatform | "";
                  setOemPlatform(p);
                  if (p === "tata_ace_ev") setModel("Tata Ace EV");
                  if (p === "mahindra_zeo") setModel("Mahindra Zeo");
                  if (p === "switch_ev") setModel("Switch IeV");
                  if (p === "eicher_ev") setModel("Eicher Pro X");
                }}
              >
                <option value="">Demo / unspecified</option>
                <option value="tata_ace_ev">Tata Ace EV (58 params, cells)</option>
                <option value="mahindra_zeo">Mahindra Zeo</option>
                <option value="switch_ev">Switch (no cell data / no SOH)</option>
                <option value="eicher_ev">Eicher (coulomb-counted SOH)</option>
              </Select>
            </Field>
            <Field label="Model" hint="Shown on asset cards and maintenance views.">
              <Input value={model} onChange={(e) => setModel(e.target.value)} required />
            </Field>
            {oemPlatform === "eicher_ev" ? (
              <Field label="Nominal capacity (Ah)" hint="Denominator for coulomb-counted SOH. Required on Eicher.">
                <Input type="number" value={nominalAh} onChange={(e) => setNominalAh(Number(e.target.value))} />
              </Field>
            ) : null}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-line text-brand focus:ring-brand"
              checked={allowImmobilise}
              onChange={(e) => setAllowImmobilise(e.target.checked)}
            />
            Allow remote immobilisation (GPS relay / gateway command path)
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Seed latitude">
              <Input
                type="number"
                step="0.0001"
                value={seedLat}
                onChange={(e) => setSeedLat(Number(e.target.value))}
              />
            </Field>
            <Field label="Seed longitude">
              <Input
                type="number"
                step="0.0001"
                value={seedLng}
                onChange={(e) => setSeedLng(Number(e.target.value))}
              />
            </Field>
            <Field label="Battery pack (kWh)">
              <Input
                type="number"
                step="0.1"
                value={kwhPack}
                onChange={(e) => setKwhPack(Number(e.target.value))}
              />
            </Field>
            <Field label="Odometer (km)">
              <Input
                type="number"
                value={odometerKm}
                onChange={(e) => setOdometerKm(Number(e.target.value))}
              />
            </Field>
            <Field label="SOC seed %" hint="Optional starting charge for demo strip.">
              <Input
                type="number"
                min={0}
                max={100}
                value={socPercent}
                onChange={(e) => setSocPercent(Number(e.target.value))}
              />
            </Field>
            <Field label="Location label">
              <Input value={locationLabel} onChange={(e) => setLocationLabel(e.target.value)} required />
            </Field>
          </div>
          {msg ? <div className="text-sm text-red-600">{msg}</div> : null}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={busy} className="px-6">
              <Bike className="h-4 w-4" />
              Register into fleet
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
