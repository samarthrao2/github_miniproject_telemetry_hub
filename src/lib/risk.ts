import { desc, eq } from "drizzle-orm";
import { dbFor, type Role } from "@/db";
import { fleetAssets, telemetryLogs } from "@/db/schema";
import { describeReading, type Reading } from "./failure-text";
import { embedMany } from "./embeddings";
import { COLLECTION, qdrant } from "./qdrant";

export type RiskLevel = "normal" | "low" | "medium" | "high";

export type Neighbour = { ticketId: number; failureType: string; subsystem: string; brand: string; vehicleId: string; score: number };

export type ReadingRisk = {
  logId: number;
  timestamp: string;
  level: RiskLevel;
  signals: string[];
  neighbours: Neighbour[];
};

export type RiskAssessment = {
  vehicleId: string;
  window: number;
  latest: ReadingRisk | null;
  flagged: ReadingRisk[];
};

/**
 * Similarity of the closest past failure -> risk level. Cut-offs come from a leave-one-out check on the
 * dataset (each failure scored against the other 34): real failures score a median 0.85, normal readings
 * that merely show one anomaly score a median 0.65. At "high" (>= 0.75 and >= 2 signals) 30/35 failures
 * are caught but about half of what is flagged is not a labelled failure.
 */
export function levelFor(topScore: number, signals: number): RiskLevel {
  if (topScore >= 0.75 && signals >= 2) return "high";
  if (topScore >= 0.7) return "medium";
  return "low";
}

const MAX_SCORED = 8; // embed at most this many anomalous readings per request

/**
 * Nearest-neighbour risk scoring: describe each recent anomalous reading in words, embed it and
 * find the most similar past failures in Qdrant. Readings with no anomaly signal are "normal"
 * and never reach the vector store.
 */
export async function assessVehicle(role: Role, vehicleId: string, window = 200): Promise<RiskAssessment | null> {
  const { db } = dbFor(role);
  const rows = await db
    .select({
      logId: telemetryLogs.logId,
      timestamp: telemetryLogs.timestamp,
      brand: fleetAssets.brand,
      engineTempC: telemetryLogs.engineTempC,
      engineRpm: telemetryLogs.engineRpm,
      sensors: telemetryLogs.sensorData,
    })
    .from(telemetryLogs)
    .innerJoin(fleetAssets, eq(fleetAssets.assetId, telemetryLogs.assetId))
    .where(eq(fleetAssets.vehicleId, vehicleId))
    .orderBy(desc(telemetryLogs.timestamp))
    .limit(window);
  if (!rows.length) return null;

  const described = rows.map((r) => {
    const reading: Reading = { ...r.sensors, engine_temp_c: r.engineTempC, engine_rpm: r.engineRpm };
    return { r, d: describeReading(r.brand, vehicleId, reading) };
  });

  // Score the newest reading plus the most anomalous others.
  const anomalous = described.filter((x) => x.d);
  const latestRow = described[0];
  const chosen = new Map<number, (typeof anomalous)[number]>();
  if (latestRow.d) chosen.set(latestRow.r.logId, latestRow as (typeof anomalous)[number]);
  for (const x of [...anomalous].sort((a, b) => b.d!.signals.length - a.d!.signals.length)) {
    if (chosen.size >= MAX_SCORED) break;
    chosen.set(x.r.logId, x);
  }

  const items = [...chosen.values()];
  const vectors = items.length ? await embedMany(items.map((x) => x.d!.text)) : [];
  const scored = new Map<number, ReadingRisk>();
  for (let i = 0; i < items.length; i++) {
    const { r, d } = items[i];
    const { points } = await qdrant.query(COLLECTION, { query: vectors[i], limit: 3, with_payload: true });
    const neighbours: Neighbour[] = points.map((p) => ({
      ticketId: Number(p.id),
      failureType: String(p.payload?.failure_type ?? ""),
      subsystem: String(p.payload?.subsystem ?? ""),
      brand: String(p.payload?.brand ?? ""),
      vehicleId: String(p.payload?.vehicle_id ?? ""),
      score: p.score,
    }));
    scored.set(r.logId, {
      logId: r.logId,
      timestamp: r.timestamp.toISOString(),
      level: levelFor(neighbours[0]?.score ?? 0, d!.signals.length),
      signals: d!.signals,
      neighbours,
    });
  }

  const latest: ReadingRisk | null = latestRow.d
    ? scored.get(latestRow.r.logId)!
    : { logId: latestRow.r.logId, timestamp: latestRow.r.timestamp.toISOString(), level: "normal", signals: [], neighbours: [] };

  const order = { high: 0, medium: 1, low: 2, normal: 3 } as const;
  const flagged = [...scored.values()]
    .filter((x) => x.logId !== latest.logId)
    .sort((a, b) => order[a.level] - order[b.level] || (b.neighbours[0]?.score ?? 0) - (a.neighbours[0]?.score ?? 0));

  return { vehicleId, window: rows.length, latest, flagged };
}
