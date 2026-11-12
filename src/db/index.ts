import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export type Role = "admin" | "viewer";

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set (see .env.example)`);
  return v;
};

function connect(user: string, password: string) {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3307),
    database: need("MYSQL_DATABASE"),
    user,
    password,
    connectionLimit: 5,
    timezone: "Z",
  });
  return { pool, db: drizzle(pool, { schema, mode: "default" }) };
}

type Conn = ReturnType<typeof connect>;
const g = globalThis as unknown as { __conns?: Partial<Record<"admin" | "viewer" | "auth", Conn>> };
const conns = (g.__conns ??= {});

/**
 * The app connects to MySQL as a different database account depending on the logged-in role,
 * so MySQL itself (GRANTs on fleet_admin_role / fleet_viewer_role) enforces what each role may do.
 */
export function dbFor(role: Role): Conn {
  return (conns[role] ??= connect(
    need(role === "admin" ? "DB_ADMIN_USER" : "DB_VIEWER_USER"),
    need(role === "admin" ? "DB_ADMIN_PASSWORD" : "DB_VIEWER_PASSWORD"),
  ));
}

/** Account that can only SELECT from `users`, used to verify logins. */
export function authConn(): Conn {
  return (conns.auth ??= connect(need("DB_AUTH_USER"), need("DB_AUTH_PASSWORD")));
}
