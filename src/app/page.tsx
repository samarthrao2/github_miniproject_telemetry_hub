import { getLatestTelemetry, getRiskAssessment, getVehicles } from "./actions";
import TelemetryExplorer from "@/components/TelemetryExplorer";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TelemetryPage() {
  await requireSession();
  const vehicles = await getVehicles();
  if (!vehicles.length) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
        No vehicles found. Run <code>npm run db:migrate</code> and <code>npm run db:seed</code> first.
      </p>
    );
  }
  const [initial, initialRisk] = await Promise.all([
    getLatestTelemetry(vehicles[0].vehicleId),
    getRiskAssessment(vehicles[0].vehicleId),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Telemetry Dashboard</h1>
      <TelemetryExplorer vehicles={vehicles} initial={initial} initialRisk={initialRisk} />
    </div>
  );
}
