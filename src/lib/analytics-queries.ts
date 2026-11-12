// Advanced SQL shown on the Analytics page. Every query runs on the logged-in role's MySQL account.

export type AnalyticsQuery = { key: string; title: string; concept: string; sql: string };

export const ANALYTICS: AnalyticsQuery[] = [
  {
    key: "recursive-cte",
    title: "Readings per 6-hour bucket",
    concept: "Recursive CTE",
    sql: `WITH RECURSIVE bounds AS (
  SELECT TIMESTAMP(DATE(MIN(\`timestamp\`))) AS lo, MAX(\`timestamp\`) AS hi FROM telemetry_logs
), buckets AS (
  SELECT lo AS bucket_start FROM bounds
  UNION ALL
  SELECT b.bucket_start + INTERVAL 6 HOUR
  FROM buckets b JOIN bounds ON b.bucket_start + INTERVAL 6 HOUR <= bounds.hi
)
SELECT b.bucket_start,
       COUNT(t.log_id)              AS readings,
       ROUND(AVG(t.speed), 1)       AS avg_speed_kph
FROM buckets b
LEFT JOIN telemetry_logs t
  ON t.\`timestamp\` >= b.bucket_start AND t.\`timestamp\` < b.bucket_start + INTERVAL 6 HOUR
GROUP BY b.bucket_start
ORDER BY b.bucket_start`,
  },
  {
    key: "correlated",
    title: "Vehicles running hotter than their brand average",
    concept: "Correlated subquery",
    sql: `SELECT a.vehicle_id, a.brand, ROUND(AVG(t.engine_temp_c), 2) AS avg_temp_c
FROM fleet_assets a
JOIN telemetry_logs t ON t.asset_id = a.asset_id
GROUP BY a.asset_id, a.vehicle_id, a.brand
HAVING AVG(t.engine_temp_c) > (
  SELECT AVG(t2.engine_temp_c)
  FROM telemetry_logs t2
  JOIN fleet_assets a2 ON a2.asset_id = t2.asset_id
  WHERE a2.brand = a.brand          -- correlated to the outer row
)
ORDER BY avg_temp_c DESC
LIMIT 15`,
  },
  {
    key: "nested",
    title: "Vehicles with an unresolved ticket, plus their latest odometer",
    concept: "Nested subqueries (IN + scalar) and a user-defined function",
    sql: `SELECT a.vehicle_id, a.brand,
       fn_failure_count(a.asset_id) AS total_tickets,
       (SELECT MAX(t.odometer) FROM telemetry_logs t WHERE t.asset_id = a.asset_id) AS odometer
FROM fleet_assets a
WHERE a.asset_id IN (
  SELECT asset_id FROM maintenance_tickets WHERE status IN ('open', 'in_progress')
)
ORDER BY total_tickets DESC, a.vehicle_id`,
  },
  {
    key: "cte-join",
    title: "Failure rate by brand",
    concept: "Non-recursive CTEs with LEFT JOINs",
    sql: `WITH vehicles AS (
  SELECT brand, COUNT(*) AS vehicles FROM fleet_assets GROUP BY brand
), tickets AS (
  SELECT a.brand, COUNT(*) AS tickets
  FROM maintenance_tickets m JOIN fleet_assets a ON a.asset_id = m.asset_id
  GROUP BY a.brand
)
SELECT v.brand, v.vehicles, COALESCE(t.tickets, 0) AS tickets,
       ROUND(COALESCE(t.tickets, 0) / v.vehicles, 2) AS tickets_per_vehicle
FROM vehicles v LEFT JOIN tickets t ON t.brand = v.brand
ORDER BY tickets_per_vehicle DESC`,
  },
  {
    key: "window",
    title: "Hottest reading per brand",
    concept: "Window function (ROW_NUMBER) over a join",
    sql: `SELECT brand, vehicle_id, \`timestamp\`, engine_temp_c FROM (
  SELECT a.brand, a.vehicle_id, t.\`timestamp\`, t.engine_temp_c,
         ROW_NUMBER() OVER (PARTITION BY a.brand ORDER BY t.engine_temp_c DESC) AS rn
  FROM telemetry_logs t JOIN fleet_assets a ON a.asset_id = t.asset_id
) ranked
WHERE rn = 1
ORDER BY engine_temp_c DESC`,
  },
  {
    key: "json",
    title: "Low battery voltage readings from the JSON sensor column",
    concept: "JSON path extraction",
    sql: `SELECT a.vehicle_id, t.\`timestamp\`,
       JSON_EXTRACT(t.sensor_data, '$.battery_voltage_v') AS battery_voltage_v,
       JSON_EXTRACT(t.sensor_data, '$.battery_charge_percent') AS battery_charge_pct
FROM telemetry_logs t JOIN fleet_assets a ON a.asset_id = t.asset_id
WHERE JSON_EXTRACT(t.sensor_data, '$.battery_voltage_v') < 11
ORDER BY battery_voltage_v
LIMIT 15`,
  },
  {
    key: "view",
    title: "Busiest vehicle-days (view)",
    concept: "View: daily_fleet_stats",
    sql: `SELECT vehicle_id, brand, day, readings, max_speed_kph, avg_engine_temp_c, distance_km
FROM daily_fleet_stats
ORDER BY max_speed_kph DESC
LIMIT 10`,
  },
  {
    key: "procedure",
    title: "Fleet summary by brand",
    concept: "Stored procedure: CALL sp_fleet_summary()",
    sql: `CALL sp_fleet_summary()`,
  },
  {
    key: "partition",
    title: "Partition layout of telemetry_logs",
    concept: "Range partitioning (information_schema)",
    sql: `SELECT PARTITION_NAME AS partition_name, PARTITION_DESCRIPTION AS less_than, TABLE_ROWS AS approx_rows
FROM information_schema.PARTITIONS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'telemetry_logs'
ORDER BY PARTITION_ORDINAL_POSITION`,
  },
];
