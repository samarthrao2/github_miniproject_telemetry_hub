// Turns telemetry into semantic descriptions suitable for embedding. Thresholds sit just
// outside the 5th/95th percentile of healthy rows in the dataset. The same anomaly rules
// describe historical failures (stored in Qdrant) and live readings (used for risk scoring),
// so both kinds of text use the same vocabulary.

export type FailureRow = {
  brand: string;
  vehicle_id: string;
  failure_type: string;
  engine_failure_imminent: string;
  brake_issue_imminent: string;
  battery_issue_imminent: string;
  [k: string]: string;
};

export type Subsystem = "engine" | "brake" | "battery";

export function subsystemOf(r: FailureRow): Subsystem {
  if (r.engine_failure_imminent === "1") return "engine";
  if (r.brake_issue_imminent === "1") return "brake";
  return "battery";
}

export type Reading = Record<string, number | null | undefined>;

/** Human-readable anomaly phrases for a reading (empty array = nothing unusual). */
export function anomalyNotes(v: Reading): string[] {
  const notes: string[] = [];
  const gt = (k: string, limit: number) => typeof v[k] === "number" && (v[k] as number) > limit;
  const lt = (k: string, limit: number) => typeof v[k] === "number" && (v[k] as number) < limit;
  const x = (k: string) => v[k] as number;

  if (gt("engine_temp_c", 104)) notes.push(`overheating engine at ${x("engine_temp_c").toFixed(0)}°C`);
  if (gt("engine_rpm", 3400)) notes.push(`high RPM of ${x("engine_rpm").toFixed(0)}`);
  if (lt("oil_pressure_psi", 20)) notes.push(`dangerously low oil pressure of ${x("oil_pressure_psi").toFixed(1)} psi`);
  if (gt("vibration_level", 3)) notes.push(`excessive vibration level ${x("vibration_level").toFixed(1)}`);
  if (gt("brake_temp_c", 250)) notes.push(`overheated brakes at ${x("brake_temp_c").toFixed(0)}°C`);
  if (lt("brake_fluid_level_psi", 750)) notes.push(`low brake fluid pressure of ${x("brake_fluid_level_psi").toFixed(0)} psi`);
  if (gt("brake_pad_wear_mm", 9)) notes.push(`worn brake pads at ${x("brake_pad_wear_mm").toFixed(1)} mm wear`);
  if (lt("battery_voltage_v", 11.5)) notes.push(`low battery voltage of ${x("battery_voltage_v").toFixed(1)} V`);
  if (lt("battery_current_a", -35)) notes.push(`heavy battery drain at ${x("battery_current_a").toFixed(0)} A`);
  return notes;
}

const toReading = (r: Record<string, string>): Reading =>
  Object.fromEntries(Object.entries(r).map(([k, val]) => [k, val === "" ? null : Number(val)]));

/** Description of a labelled historical failure (what gets embedded into Qdrant). */
export function describeFailure(r: FailureRow): string {
  const sub = subsystemOf(r);
  const notes = anomalyNotes(toReading(r));
  const issue =
    sub === "engine" ? "engine failure" : sub === "brake" ? "brake system issue" : "battery issue";
  const detail = notes.length ? ` with ${notes.join(", ")}` : "";
  return `${r.brand} vehicle ${r.vehicle_id} experienced ${issue} (${r.failure_type})${detail}.`;
}

/** Description of a live reading, or null when it shows no anomaly. Worded like describeFailure. */
export function describeReading(brand: string, vehicleId: string, v: Reading): { text: string; signals: string[] } | null {
  const signals = anomalyNotes(v);
  if (!signals.length) return null;
  return { text: `${brand} vehicle ${vehicleId} showing ${signals.join(", ")}.`, signals };
}
