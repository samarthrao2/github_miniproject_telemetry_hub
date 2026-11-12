"use server";

import { desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { dbFor } from "@/db";
import { fleetAssets, maintenanceTickets } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { embed } from "@/lib/embeddings";
import { COLLECTION, qdrant } from "@/lib/qdrant";

export type TicketRow = {
  ticketId: number;
  vehicleId: string;
  brand: string;
  failureType: string;
  subsystem: "engine" | "brake" | "battery";
  status: "open" | "in_progress" | "resolved";
  issueDescription: string;
  occurredAt: string;
};

const SUBSYSTEMS = ["engine", "brake", "battery"] as const;
const STATUSES = ["open", "in_progress", "resolved"] as const;

export async function listTickets(): Promise<TicketRow[]> {
  const { role } = await requireRole();
  const rows = await dbFor(role)
    .db.select({
      ticketId: maintenanceTickets.ticketId,
      vehicleId: fleetAssets.vehicleId,
      brand: fleetAssets.brand,
      failureType: maintenanceTickets.failureType,
      subsystem: maintenanceTickets.subsystem,
      status: maintenanceTickets.status,
      issueDescription: maintenanceTickets.issueDescription,
      occurredAt: maintenanceTickets.occurredAt,
    })
    .from(maintenanceTickets)
    .innerJoin(fleetAssets, eq(fleetAssets.assetId, maintenanceTickets.assetId))
    .orderBy(desc(maintenanceTickets.ticketId));
  return rows.map((r) => ({ ...r, occurredAt: r.occurredAt.toISOString() }));
}

async function upsertVector(t: { ticketId: number; description: string; brand: string; vehicleId: string; failureType: string; subsystem: string }) {
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: [
      {
        id: t.ticketId,
        vector: await embed(t.description),
        payload: {
          ticket_id: t.ticketId,
          brand: t.brand,
          vehicle_id: t.vehicleId,
          failure_type: t.failureType,
          subsystem: t.subsystem,
        },
      },
    ],
  });
}

/** INSERT in MySQL, then embed + upsert to Qdrant (rolled back in MySQL if Qdrant fails). */
export async function createTicket(input: {
  vehicleId: string;
  failureType: string;
  subsystem: string;
  description: string;
}): Promise<{ ok: true; ticketId: number } | { ok: false; error: string }> {
  await requireRole("admin");
  const failureType = input.failureType.trim();
  const description = input.description.trim();
  if (!failureType || failureType.length > 60) return { ok: false, error: "Failure type is required (max 60 chars)." };
  if (!description) return { ok: false, error: "Description is required." };
  if (!SUBSYSTEMS.includes(input.subsystem as (typeof SUBSYSTEMS)[number])) return { ok: false, error: "Invalid subsystem." };

  const { db } = dbFor("admin");
  const [asset] = await db.select().from(fleetAssets).where(eq(fleetAssets.vehicleId, input.vehicleId)).limit(1);
  if (!asset) return { ok: false, error: "Unknown vehicle." };

  const [res] = await db.insert(maintenanceTickets).values({
    assetId: asset.assetId,
    issueDescription: description,
    failureType,
    subsystem: input.subsystem as (typeof SUBSYSTEMS)[number],
    occurredAt: new Date(),
  });
  const ticketId = res.insertId;
  try {
    await upsertVector({ ticketId, description, brand: asset.brand, vehicleId: asset.vehicleId, failureType, subsystem: input.subsystem });
  } catch (e) {
    await db.delete(maintenanceTickets).where(eq(maintenanceTickets.ticketId, ticketId));
    return { ok: false, error: `Vector store unavailable: ${e instanceof Error ? e.message : e}` };
  }
  revalidatePath("/tickets");
  return { ok: true, ticketId };
}

/** UPDATE in MySQL (audited by trigger) and re-embed the new text in Qdrant. */
export async function updateTicket(input: {
  ticketId: number;
  description: string;
  status: string;
}): Promise<{ ok: boolean; error?: string }> {
  await requireRole("admin");
  const description = input.description.trim();
  if (!description) return { ok: false, error: "Description is required." };
  if (!STATUSES.includes(input.status as (typeof STATUSES)[number])) return { ok: false, error: "Invalid status." };

  const { db } = dbFor("admin");
  await db
    .update(maintenanceTickets)
    .set({ issueDescription: description, status: input.status as (typeof STATUSES)[number] })
    .where(eq(maintenanceTickets.ticketId, input.ticketId));

  const [t] = await db
    .select({
      ticketId: maintenanceTickets.ticketId,
      failureType: maintenanceTickets.failureType,
      subsystem: maintenanceTickets.subsystem,
      brand: fleetAssets.brand,
      vehicleId: fleetAssets.vehicleId,
    })
    .from(maintenanceTickets)
    .innerJoin(fleetAssets, eq(fleetAssets.assetId, maintenanceTickets.assetId))
    .where(eq(maintenanceTickets.ticketId, input.ticketId));
  if (!t) return { ok: false, error: "Ticket not found." };
  await upsertVector({ ...t, description });
  revalidatePath("/tickets");
  return { ok: true };
}

/** DELETE in MySQL (audited by trigger) and remove the vector from Qdrant. */
export async function deleteTicket(ticketId: number): Promise<{ ok: boolean }> {
  await requireRole("admin");
  await dbFor("admin").db.delete(maintenanceTickets).where(eq(maintenanceTickets.ticketId, ticketId));
  await qdrant.delete(COLLECTION, { wait: true, points: [ticketId] });
  revalidatePath("/tickets");
  return { ok: true };
}

/** Calls the sp_resolve_ticket stored procedure. */
export async function resolveTicket(ticketId: number): Promise<{ ok: boolean; error?: string }> {
  await requireRole("admin");
  try {
    await dbFor("admin").pool.query("CALL sp_resolve_ticket(?)", [ticketId]);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed" };
  }
  revalidatePath("/tickets");
  return { ok: true };
}

/** Read: what Qdrant actually stores for this ticket (payload + vector size). */
export async function inspectVector(ticketId: number) {
  await requireRole();
  const pts = await qdrant.retrieve(COLLECTION, { ids: [ticketId], with_payload: true, with_vector: true });
  const p = pts[0];
  if (!p) return null;
  const v = Array.isArray(p.vector) ? (p.vector as number[]) : [];
  return { id: p.id, payload: p.payload ?? {}, dimensions: v.length, values: v.map((x) => Number(x.toFixed(4))) };
}

export type AuditRow = {
  auditId: number;
  ticketId: number;
  action: string;
  oldStatus: string | null;
  newStatus: string | null;
  changedBy: string;
  changedAt: string;
};

/** Trigger-populated audit trail (admin only: the viewer account has no SELECT on ticket_audit). */
export async function listAudit(): Promise<AuditRow[]> {
  await requireRole("admin");
  const [rows] = await dbFor("admin").pool.query(
    "SELECT audit_id, ticket_id, action, old_status, new_status, changed_by, changed_at FROM ticket_audit ORDER BY audit_id DESC LIMIT 20",
  );
  return (rows as Record<string, unknown>[]).map((r) => ({
    auditId: Number(r.audit_id),
    ticketId: Number(r.ticket_id),
    action: String(r.action),
    oldStatus: (r.old_status as string) ?? null,
    newStatus: (r.new_status as string) ?? null,
    changedBy: String(r.changed_by),
    changedAt: new Date(r.changed_at as string | Date).toISOString(),
  }));
}

/** Demonstrates database-level RBAC: runs a harmless write with the current role's DB account. */
export async function probeWriteAccess(): Promise<{ account: string; allowed: boolean; message: string }> {
  const { role } = await requireRole();
  const { db } = dbFor(role);
  try {
    await db.execute(sql`UPDATE maintenance_tickets SET status = status WHERE ticket_id = -1`);
    return { account: `MySQL role fleet_${role}_role`, allowed: true, message: "UPDATE succeeded." };
  } catch (e) {
    const err = e as { cause?: { message?: string }; message?: string };
    return { account: `MySQL role fleet_${role}_role`, allowed: false, message: err.cause?.message ?? err.message ?? "Denied" };
  }
}
