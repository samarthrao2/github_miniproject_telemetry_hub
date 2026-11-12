"use server";

import { desc, eq } from "drizzle-orm";
import { dbFor } from "@/db";
import { dailyFleetStats, fleetAssets, telemetryLogs } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { assessVehicle, type RiskAssessment } from "@/lib/risk";

export type VehicleOption = { vehicleId: string; brand: string };

export type TelemetryPoint = {
  logId: number;
  timestamp: string;
  speed: number | null;
  engineTempC: number | null;
  engineRpm: number | null;
  odometer: number | null;
  lat: number | null;
  lng: number | null;
  batteryVoltage: number | null;
  fuelLevel: number | null;
};

export type DailyStat = {
  day: string;
  readings: number;
  maxSpeedKph: number | null;
  avgEngineTempC: number | null;
  distanceKm: number | null;
};

export type VehicleTelemetry = {
  vehicle: VehicleOption;
  points: TelemetryPoint[];
  daily: DailyStat[];
};

/** Nearest-neighbour risk scoring against historical failures in Qdrant (see src/lib/risk.ts). */
export async function getRiskAssessment(vehicleId: string): Promise<RiskAssessment | null> {
  const { role } = await requireRole();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(vehicleId)) return null;
  return assessVehicle(role, vehicleId);
}

export async function getVehicles(): Promise<VehicleOption[]> {
  const { role } = await requireRole();
  return dbFor(role)
    .db.select({ vehicleId: fleetAssets.vehicleId, brand: fleetAssets.brand })
    .from(fleetAssets)
    .orderBy(fleetAssets.vehicleId);
}

/** Latest telemetry for one vehicle: telemetry_logs JOIN fleet_assets, newest first. */
export async function getLatestTelemetry(vehicleId: string, limit = 200): Promise<VehicleTelemetry | null> {
  const { role } = await requireRole();
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(vehicleId)) return null;
  const n = Math.min(Math.max(Math.trunc(limit) || 200, 1), 1000);
  const { db } = dbFor(role);

  const rows = await db
    .select({
      vehicleId: fleetAssets.vehicleId,
      brand: fleetAssets.brand,
      logId: telemetryLogs.logId,
      timestamp: telemetryLogs.timestamp,
      speed: telemetryLogs.speed,
      engineTempC: telemetryLogs.engineTempC,
      engineRpm: telemetryLogs.engineRpm,
      odometer: telemetryLogs.odometer,
      lat: telemetryLogs.gpsLatitude,
      lng: telemetryLogs.gpsLongitude,
      sensors: telemetryLogs.sensorData,
    })
    .from(telemetryLogs)
    .innerJoin(fleetAssets, eq(fleetAssets.assetId, telemetryLogs.assetId))
    .where(eq(fleetAssets.vehicleId, vehicleId))
    .orderBy(desc(telemetryLogs.timestamp))
    .limit(n);

  if (!rows.length) return null;

  const daily = await db
    .select()
    .from(dailyFleetStats)
    .where(eq(dailyFleetStats.vehicleId, vehicleId))
    .orderBy(desc(dailyFleetStats.day));

  return {
    vehicle: { vehicleId: rows[0].vehicleId, brand: rows[0].brand },
    points: rows.map((r) => ({
      logId: r.logId,
      timestamp: r.timestamp.toISOString(),
      speed: r.speed,
      engineTempC: r.engineTempC,
      engineRpm: r.engineRpm,
      odometer: r.odometer,
      lat: r.lat,
      lng: r.lng,
      batteryVoltage: r.sensors?.battery_voltage_v ?? null,
      fuelLevel: r.sensors?.fuel_level_percent ?? null,
    })),
    daily: daily.map((d) => ({
      day: String(d.day),
      readings: Number(d.readings),
      maxSpeedKph: d.maxSpeedKph,
      avgEngineTempC: d.avgEngineTempC === null ? null : Number(d.avgEngineTempC),
      distanceKm: d.distanceKm === null ? null : Number(d.distanceKm),
    })),
  };
}
