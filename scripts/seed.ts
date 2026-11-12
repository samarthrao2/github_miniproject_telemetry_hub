import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../src/db/schema";
import { fleetAssets, maintenanceTickets, telemetryLogs, users, type SensorData } from "../src/db/schema";
import { EMBEDDING_DIM, embedMany } from "../src/lib/embeddings";
import { describeFailure, subsystemOf, type FailureRow } from "../src/lib/failure-text";
import { hashPassword } from "../src/lib/password";
import { COLLECTION, qdrant } from "../src/lib/qdrant";

const CSV_PATH = process.env.TELEMETRY_CSV ?? path.join(process.cwd(), "data", "synthetic_telemetry_data.csv");
const BATCH = 500;

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see .env.example)`);
  return v;
};

// Columns promoted to real columns on telemetry_logs, or not sensor readings at all.
const NOT_SENSOR = new Set([
  "vehicle_id", "brand", "timestamp", "odometer_reading", "engine_temp_c", "engine_rpm",
  "vehicle_speed_kph", "gps_latitude", "gps_longitude",
  "engine_failure_imminent", "brake_issue_imminent", "battery_issue_imminent",
  "failure_date", "failure_type",
]);

type Row = Record<string, string>;

const num = (v: string | undefined) => {
  if (v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const utc = (s: string) => new Date(s.replace(" ", "T") + "Z");

async function main() {
  const pool = mysql.createPool({
    host: env("MYSQL_HOST"),
    port: Number(env("MYSQL_PORT")),
    user: "root",
    password: env("MYSQL_ROOT_PASSWORD"),
    database: env("MYSQL_DATABASE"),
    timezone: "Z",
  });
  const db = drizzle(pool, { schema, mode: "default" });

  const rows: Row[] = parse(readFileSync(CSV_PATH, "utf8"), { columns: true, skip_empty_lines: true });
  console.log(`Read ${rows.length} rows from ${CSV_PATH}`);

  // 1. Monthly partitions for every month present in the data (stored procedure).
  const months = [...new Set(rows.map((r) => r.timestamp.slice(0, 7)))].sort();
  for (const m of months) await pool.query("CALL ensure_telemetry_partition(?)", [`${m}-01`]);
  console.log(`Partitions ensured for: ${months.join(", ")}`);

  // 2. Reset data (idempotent re-seed). FK checks are off only for the truncates.
  await pool.query("SET FOREIGN_KEY_CHECKS = 0");
  for (const t of ["ticket_audit", "maintenance_tickets", "telemetry_logs", "fleet_assets"]) {
    await pool.query(`TRUNCATE TABLE \`${t}\``);
  }
  await pool.query("SET FOREIGN_KEY_CHECKS = 1");

  // 3. Web-app users (scrypt-hashed passwords).
  await db.delete(users);
  await db.insert(users).values([
    { username: env("APP_ADMIN_USERNAME"), passwordHash: hashPassword(env("APP_ADMIN_PASSWORD")), role: "admin" },
    { username: env("APP_VIEWER_USERNAME"), passwordHash: hashPassword(env("APP_VIEWER_PASSWORD")), role: "viewer" },
  ]);

  // 4. Unique vehicles -> fleet_assets.
  const vehicles = new Map<string, string>();
  for (const r of rows) vehicles.set(r.vehicle_id, r.brand);
  await db.insert(fleetAssets).values([...vehicles].map(([vehicleId, brand]) => ({ vehicleId, brand })));
  const assets = await db.select().from(fleetAssets);
  const assetId = new Map(assets.map((a) => [a.vehicleId, a.assetId]));
  console.log(`Inserted ${assets.length} fleet_assets`);

  // 5. All telemetry rows, minor sensors folded into the JSON column.
  const sensorKeys = Object.keys(rows[0]).filter((k) => !NOT_SENSOR.has(k));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => {
      const sensorData: SensorData = {};
      for (const k of sensorKeys) sensorData[k] = num(r[k]);
      return {
        assetId: assetId.get(r.vehicle_id)!,
        timestamp: utc(r.timestamp),
        gpsLatitude: num(r.gps_latitude),
        gpsLongitude: num(r.gps_longitude),
        speed: num(r.vehicle_speed_kph),
        engineTempC: num(r.engine_temp_c),
        engineRpm: num(r.engine_rpm),
        odometer: num(r.odometer_reading),
        sensorData,
      };
    });
    await db.insert(telemetryLogs).values(chunk as (typeof telemetryLogs.$inferInsert)[]);
    inserted += chunk.length;
  }
  console.log(`Inserted ${inserted} telemetry_logs`);

  // 6. Tickets for failure rows.
  const failures = rows.filter((r) => r.failure_type !== "No Failure");
  await db.insert(maintenanceTickets).values(
    failures.map((r) => ({
      assetId: assetId.get(r.vehicle_id)!,
      issueDescription: describeFailure(r as FailureRow),
      failureType: r.failure_type,
      subsystem: subsystemOf(r as FailureRow),
      occurredAt: utc(r.timestamp),
    })),
  );
  const tickets = await db.select().from(maintenanceTickets).orderBy(maintenanceTickets.ticketId);
  console.log(`Inserted ${tickets.length} maintenance_tickets`);

  // 7. Qdrant: recreate collection, index brand for filtered search, upsert vectors.
  const existing = await qdrant.getCollections();
  if (existing.collections.some((c) => c.name === COLLECTION)) await qdrant.deleteCollection(COLLECTION);
  await qdrant.createCollection(COLLECTION, { vectors: { size: EMBEDDING_DIM, distance: "Cosine" } });
  await qdrant.createPayloadIndex(COLLECTION, { field_name: "brand", field_schema: "keyword" });

  console.log("Embedding failure descriptions...");
  const vectors = await embedMany(tickets.map((t) => t.issueDescription));
  const assetById = new Map(assets.map((a) => [a.assetId, a]));
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: tickets.map((t, i) => {
      const a = assetById.get(t.assetId)!;
      return {
        id: t.ticketId,
        vector: vectors[i],
        payload: {
          ticket_id: t.ticketId,
          brand: a.brand,
          vehicle_id: a.vehicleId,
          failure_type: t.failureType,
          subsystem: t.subsystem,
        },
      };
    }),
  });
  console.log(`Upserted ${tickets.length} vectors into Qdrant collection "${COLLECTION}"`);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
