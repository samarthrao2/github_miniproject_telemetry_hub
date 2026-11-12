import "dotenv/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see .env.example)`);
  return v;
};

const DB = env("MYSQL_DATABASE");
const reset = process.argv.includes("--reset");

async function main() {
  const root = await mysql.createConnection({
    host: env("MYSQL_HOST"),
    port: Number(env("MYSQL_PORT")),
    user: "root",
    password: env("MYSQL_ROOT_PASSWORD"),
  });

  if (reset) await root.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await root.query(`CREATE DATABASE IF NOT EXISTS \`${DB}\` CHARACTER SET utf8mb4`);
  await root.query(`USE \`${DB}\``);

  const [existing] = await root.query(
    "SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'fleet_assets'",
    [DB],
  );
  if ((existing as unknown[]).length === 0) {
    const sql = readFileSync(path.join(process.cwd(), "sql", "schema.sql"), "utf8");
    const statements = sql.split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    for (const s of statements) await root.query(s);
    console.log(`Applied ${statements.length} schema statements.`);
  } else {
    console.log("Schema already present (use --reset to rebuild).");
  }

  // ---------- Database-level roles (role-based access control) ----------
  // admin : read + write on the fleet data and EXECUTE on routines
  // viewer: read-only; cannot see users/ticket_audit
  // auth  : may only read `users`, used for login lookups
  const admin = env("DB_ADMIN_USER");
  const viewer = env("DB_VIEWER_USER");
  const auth = env("DB_AUTH_USER");
  const q = (s: string, p: unknown[] = []) => root.query(s, p);

  await q("CREATE ROLE IF NOT EXISTS 'fleet_admin_role', 'fleet_viewer_role', 'fleet_auth_role'");
  await q("REVOKE ALL PRIVILEGES ON *.* FROM 'fleet_admin_role', 'fleet_viewer_role', 'fleet_auth_role'");

  const dataTables = ["fleet_assets", "telemetry_logs", "maintenance_tickets"];
  for (const t of dataTables) {
    await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${DB}\`.\`${t}\` TO 'fleet_admin_role'`);
    await q(`GRANT SELECT ON \`${DB}\`.\`${t}\` TO 'fleet_viewer_role'`);
  }
  await q(`GRANT SELECT ON \`${DB}\`.daily_fleet_stats TO 'fleet_admin_role', 'fleet_viewer_role'`);
  await q(`GRANT SELECT ON \`${DB}\`.ticket_audit TO 'fleet_admin_role'`);
  await q(`GRANT EXECUTE ON FUNCTION \`${DB}\`.fn_failure_count TO 'fleet_admin_role', 'fleet_viewer_role'`);
  await q(`GRANT EXECUTE ON PROCEDURE \`${DB}\`.sp_fleet_summary TO 'fleet_admin_role', 'fleet_viewer_role'`);
  await q(`GRANT EXECUTE ON PROCEDURE \`${DB}\`.sp_resolve_ticket TO 'fleet_admin_role'`);
  await q(`GRANT SELECT ON \`${DB}\`.users TO 'fleet_auth_role'`);

  const accounts: [string, string, string][] = [
    [admin, env("DB_ADMIN_PASSWORD"), "fleet_admin_role"],
    [viewer, env("DB_VIEWER_PASSWORD"), "fleet_viewer_role"],
    [auth, env("DB_AUTH_PASSWORD"), "fleet_auth_role"],
  ];
  for (const [user, pw, role] of accounts) {
    await q("CREATE USER IF NOT EXISTS ?@'%' IDENTIFIED BY ?", [user, pw]);
    await q("ALTER USER ?@'%' IDENTIFIED BY ?", [user, pw]);
    await q(`GRANT \`${role}\` TO ?@'%'`, [user]);
    await q(`SET DEFAULT ROLE \`${role}\` TO ?@'%'`, [user]);
  }
  console.log("Roles and users configured.");
  await root.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
