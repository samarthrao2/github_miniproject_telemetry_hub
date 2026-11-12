"use server";

import { dbFor } from "@/db";
import { requireRole } from "@/lib/auth";
import { ANALYTICS } from "@/lib/analytics-queries";

export type AnalyticsResult = { columns: string[]; rows: (string | number | null)[][] } | { error: string };

const cell = (v: unknown): string | number | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 16).replace("T", " ");
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
};

/** Runs one of the fixed, server-side queries (never client-supplied SQL). */
export async function runAnalytics(key: string): Promise<AnalyticsResult> {
  const { role } = await requireRole();
  const q = ANALYTICS.find((a) => a.key === key);
  if (!q) return { error: "Unknown query" };
  try {
    const [res] = await dbFor(role).pool.query(q.sql);
    // CALL returns [resultSets..., OkPacket]; everything else returns the rows directly.
    const rows = (q.sql.startsWith("CALL") ? (res as unknown[])[0] : res) as Record<string, unknown>[];
    const columns = rows.length ? Object.keys(rows[0]) : [];
    return { columns, rows: rows.map((r) => columns.map((c) => cell(r[c]))) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Query failed" };
  }
}
