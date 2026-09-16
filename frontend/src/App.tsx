import { Route, Routes } from "react-router-dom";
import { RequireAuth } from "@/auth/RequireAuth";
import { AppShell } from "@/layout/AppShell";
import AddVehicle from "@/pages/AddVehicle";
import Analytics from "@/pages/Analytics";
import AssetLifecycle from "@/pages/AssetLifecycle";
import BatteryHealth from "@/pages/BatteryHealth";
import PortfolioValuation from "@/pages/PortfolioValuation";
import CommandCenter from "@/pages/CommandCenter";
import Drivers from "@/pages/Drivers";
import GpsDevices from "@/pages/GpsDevices";
import Login from "@/pages/Login";
import Maintenance from "@/pages/Maintenance";
import Policy from "@/pages/Policy";
import CanTelemetry from "@/pages/CanTelemetry";

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/" element={<CommandCenter />} />
          <Route path="/add-vehicle" element={<AddVehicle />} />
          <Route path="/gps-devices" element={<GpsDevices />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/policy" element={<Policy />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/battery-health" element={<BatteryHealth />} />
          <Route path="/asset-lifecycle" element={<AssetLifecycle />} />
          <Route path="/drivers" element={<Drivers />} />
          <Route path="/portfolio-value" element={<PortfolioValuation />} />
          <Route path="/can-telemetry" element={<CanTelemetry />} />
          <Route path="/can-telemetry/:id" element={<CanTelemetry />} />
        </Route>
      </Route>
    </Routes>
  );
}
