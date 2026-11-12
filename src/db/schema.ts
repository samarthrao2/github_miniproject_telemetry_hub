import {
  bigint,
  date,
  datetime,
  double,
  float,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  mysqlView,
  primaryKey,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

// Typed mirror of sql/schema.sql (the DDL there is the source of truth: partitioning,
// triggers, CHECK constraints, view and routines cannot be expressed in Drizzle).

export const fleetAssets = mysqlTable("fleet_assets", {
  assetId: int("asset_id").autoincrement().primaryKey(),
  vehicleId: varchar("vehicle_id", { length: 20 }).notNull().unique(),
  brand: varchar("brand", { length: 50 }).notNull(),
});

export type SensorData = Record<string, number | null>;

// PARTITION BY RANGE COLUMNS (`timestamp`) — monthly partitions.
export const telemetryLogs = mysqlTable(
  "telemetry_logs",
  {
    logId: bigint("log_id", { mode: "number" }).autoincrement().notNull(),
    assetId: int("asset_id").notNull(),
    timestamp: datetime("timestamp", { mode: "date" }).notNull(),
    gpsLatitude: double("gps_latitude"),
    gpsLongitude: double("gps_longitude"),
    speed: float("speed"),
    engineTempC: float("engine_temp_c"),
    engineRpm: float("engine_rpm"),
    odometer: double("odometer"),
    sensorData: json("sensor_data").$type<SensorData>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.logId, t.timestamp] })],
);

export const maintenanceTickets = mysqlTable("maintenance_tickets", {
  ticketId: int("ticket_id").autoincrement().primaryKey(),
  assetId: int("asset_id")
    .notNull()
    .references(() => fleetAssets.assetId, { onDelete: "cascade" }),
  issueDescription: text("issue_description").notNull(),
  failureType: varchar("failure_type", { length: 60 }).notNull(),
  subsystem: mysqlEnum("subsystem", ["engine", "brake", "battery"]).notNull(),
  status: mysqlEnum("status", ["open", "in_progress", "resolved"]).notNull().default("open"),
  occurredAt: datetime("occurred_at", { mode: "date" }).notNull(),
  updatedAt: datetime("updated_at", { mode: "date" }),
});

export const users = mysqlTable("users", {
  userId: int("user_id").autoincrement().primaryKey(),
  username: varchar("username", { length: 50 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["admin", "viewer"]).notNull(),
});

export const dailyFleetStats = mysqlView("daily_fleet_stats", {
  assetId: int("asset_id"),
  vehicleId: varchar("vehicle_id", { length: 20 }),
  brand: varchar("brand", { length: 50 }),
  day: date("day", { mode: "string" }),
  readings: bigint("readings", { mode: "number" }),
  maxSpeedKph: float("max_speed_kph"),
  avgEngineTempC: double("avg_engine_temp_c"),
  maxEngineTempC: float("max_engine_temp_c"),
  avgEngineRpm: double("avg_engine_rpm"),
  distanceKm: double("distance_km"),
}).existing();
