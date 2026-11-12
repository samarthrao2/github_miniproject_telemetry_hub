"use client";

import { useState, useTransition } from "react";
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { getLatestTelemetry, getRiskAssessment, type VehicleOption, type VehicleTelemetry } from "@/app/actions";
import type { RiskAssessment } from "@/lib/risk";
import RiskCard from "./RiskCard";

const fmt = (v: number | null, d = 1) => (v === null ? "—" : v.toFixed(d));
const time = (iso: string) => iso.slice(5, 16).replace("T", " ");

export default function TelemetryExplorer({
  vehicles,
  initial,
  initialRisk,
}: {
  vehicles: VehicleOption[];
  initial: VehicleTelemetry | null;
  initialRisk: RiskAssessment | null;
}) {
  const [selected, setSelected] = useState(vehicles[0].vehicleId);
  const [data, setData] = useState(initial);
  const [risk, setRisk] = useState(initialRisk);
  const [pending, start] = useTransition();

  function onChange(id: string) {
    setSelected(id);
    start(async () => {
      const [t, r] = await Promise.all([getLatestTelemetry(id), getRiskAssessment(id)]);
      setData(t);
      setRisk(r);
    });
  }

  // Server returns newest first; chart wants chronological.
  const series = data ? [...data.points].reverse().map((p) => ({ ...p, t: time(p.timestamp) })) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label htmlFor="vehicle" className="text-sm font-medium">Vehicle</label>
        <select
          id="vehicle"
          value={selected}
          onChange={(e) => onChange(e.target.value)}
          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm"
        >
          {vehicles.map((v) => (
            <option key={v.vehicleId} value={v.vehicleId}>{v.vehicleId} — {v.brand}</option>
          ))}
        </select>
        {pending && <span className="text-sm text-slate-500">Loading…</span>}
      </div>

      {!data ? (
        <p className="text-sm text-slate-500">No telemetry for this vehicle.</p>
      ) : (
        <div className={pending ? "opacity-60" : ""}>
          <div className="mb-6"><RiskCard risk={risk} loading={pending} /></div>
          <section className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Engine temperature &amp; speed — {data.vehicle.brand} {data.vehicle.vehicleId}</h2>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={40} fontSize={11} />
                  <YAxis yAxisId="l" fontSize={11} />
                  <YAxis yAxisId="r" orientation="right" fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Line yAxisId="l" type="monotone" dataKey="engineTempC" name="Engine temp (°C)" stroke="#dc2626" dot={false} />
                  <Line yAxisId="r" type="monotone" dataKey="speed" name="Speed (km/h)" stroke="#2563eb" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Daily stats (view: daily_fleet_stats)</h2>
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500">
                <tr><th>Day</th><th>Readings</th><th>Max speed</th><th>Avg engine temp</th><th>Distance km</th></tr>
              </thead>
              <tbody>
                {data.daily.map((d) => (
                  <tr key={d.day} className="border-t border-slate-100">
                    <td>{d.day}</td><td>{d.readings}</td><td>{fmt(d.maxSpeedKph)}</td>
                    <td>{fmt(d.avgEngineTempC)}</td><td>{fmt(d.distanceKm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold">Latest readings ({data.points.length})</h2>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-slate-500">
                  <tr>
                    <th>Timestamp</th><th>Speed</th><th>Temp °C</th><th>RPM</th>
                    <th>Odometer</th><th>Battery V</th><th>Fuel %</th><th>GPS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.map((p) => (
                    <tr key={p.logId} className="border-t border-slate-100">
                      <td className="whitespace-nowrap">{time(p.timestamp)}</td>
                      <td>{fmt(p.speed)}</td><td>{fmt(p.engineTempC)}</td><td>{fmt(p.engineRpm, 0)}</td>
                      <td>{fmt(p.odometer, 0)}</td><td>{fmt(p.batteryVoltage, 2)}</td><td>{fmt(p.fuelLevel)}</td>
                      <td className="whitespace-nowrap">{fmt(p.lat, 3)}, {fmt(p.lng, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
