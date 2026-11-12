"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { VehicleOption } from "@/app/actions";
import {
  createTicket, deleteTicket, inspectVector, probeWriteAccess, resolveTicket, updateTicket,
  type AuditRow, type TicketRow,
} from "@/app/tickets-actions";

const field = "rounded border border-slate-300 bg-white px-2 py-1.5 text-sm";
const btn = "rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100";

type VectorInfo = { id: number | string; payload: Record<string, unknown>; dimensions: number; values: number[] } | null;

/** One bar per embedding dimension; blue = positive, orange = negative. */
function VectorBars({ values }: { values: number[] }) {
  const max = Math.max(...values.map(Math.abs), 1e-9);
  const w = 3;
  const h = 60;
  return (
    <svg viewBox={`0 0 ${values.length * w} ${h}`} className="h-16 w-full rounded bg-slate-50" preserveAspectRatio="none" role="img" aria-label="Embedding values">
      {values.map((v, i) => {
        const bar = (Math.abs(v) / max) * (h / 2);
        return <rect key={i} x={i * w} y={v >= 0 ? h / 2 - bar : h / 2} width={w - 0.6} height={bar} fill={v >= 0 ? "#2563eb" : "#ea580c"} />;
      })}
      <line x1="0" x2={values.length * w} y1={h / 2} y2={h / 2} stroke="#94a3b8" strokeWidth="0.5" />
    </svg>
  );
}

export default function TicketManager({
  role, tickets, vehicles, audit,
}: {
  role: "admin" | "viewer";
  tickets: TicketRow[];
  vehicles: VehicleOption[];
  audit: AuditRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState({ description: "", status: "open" });
  const [vector, setVector] = useState<{ id: number; info: VectorInfo } | null>(null);
  const vectorRef = useRef<HTMLElement>(null);
  const isAdmin = role === "admin";

  const run = (fn: () => Promise<{ ok?: boolean; error?: string } | void>) =>
    start(async () => {
      const r = await fn();
      setMsg(r && "error" in r && r.error ? r.error : null);
      router.refresh();
    });

  return (
    <div className="space-y-6">
      {msg && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{msg}</p>}

      {isAdmin ? (
        <form
          className="grid gap-2 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const form = e.currentTarget;
            run(async () => {
              const r = await createTicket({
                vehicleId: String(f.get("vehicle")),
                failureType: String(f.get("failureType")),
                subsystem: String(f.get("subsystem")),
                description: String(f.get("description")),
              });
              if (r.ok) form.reset();
              return r.ok ? undefined : r;
            });
          }}
        >
          <select name="vehicle" className={field}>
            {vehicles.map((v) => <option key={v.vehicleId} value={v.vehicleId}>{v.vehicleId} — {v.brand}</option>)}
          </select>
          <input name="failureType" placeholder="Failure type" className={field} required />
          <select name="subsystem" className={field}>
            <option>engine</option><option>brake</option><option>battery</option>
          </select>
          <input name="description" placeholder="Description" className={`${field} md:col-span-2`} required />
          <button disabled={pending} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
            Add ticket
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-3 rounded border border-slate-200 bg-white p-3 text-sm">
          <span>You are a <strong>viewer</strong>: editing is disabled.</span>
          <button
            className={btn}
            onClick={() => start(async () => {
              const r = await probeWriteAccess();
              setMsg(`${r.account}: ${r.allowed ? "write allowed" : `write blocked by MySQL — ${r.message}`}`);
            })}
          >
            Try a write as viewer
          </button>
        </div>
      )}

      {vector && (
        <section ref={vectorRef} className="space-y-3 rounded-lg border border-indigo-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Qdrant point for ticket #{vector.id}</h2>
            <button className={btn} onClick={() => setVector(null)}>Close</button>
          </div>
          {!vector.info ? (
            <p className="text-sm text-red-700">No vector found in Qdrant for this ticket.</p>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                {vector.info.dimensions} dimensions, cosine distance. Payload (metadata used for filtering):
              </p>
              <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(vector.info.payload, null, 2)}</pre>
              <VectorBars values={vector.info.values} />
              <details>
                <summary className="cursor-pointer text-xs text-slate-600">Show all {vector.info.dimensions} numbers</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs">{vector.info.values.join(", ")}</pre>
              </details>
            </>
          )}
        </section>
      )}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr><th className="p-2">#</th><th>Vehicle</th><th>Failure</th><th>Status</th><th>Description</th><th /></tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.ticketId} className="border-t border-slate-100 align-top">
                <td className="p-2">{t.ticketId}</td>
                <td className="whitespace-nowrap">{t.vehicleId}<br /><span className="text-xs text-slate-500">{t.brand}</span></td>
                <td>{t.failureType}<br /><span className="text-xs text-slate-500">{t.subsystem}</span></td>
                <td>
                  {editing === t.ticketId ? (
                    <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={field}>
                      <option>open</option><option>in_progress</option><option>resolved</option>
                    </select>
                  ) : t.status}
                </td>
                <td className="max-w-md pr-2">
                  {editing === t.ticketId ? (
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      className={`${field} w-full`} rows={3}
                    />
                  ) : t.issueDescription}
                </td>
                <td className="space-x-1 whitespace-nowrap p-2">
                  <button
                    className={btn}
                    onClick={() => start(async () => {
                      setVector({ id: t.ticketId, info: await inspectVector(t.ticketId) });
                      setTimeout(() => vectorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
                    })}
                  >
                    Vector
                  </button>
                  {isAdmin && (editing === t.ticketId ? (
                    <>
                      <button className={btn} onClick={() => run(async () => { const r = await updateTicket({ ticketId: t.ticketId, ...draft }); setEditing(null); return r; })}>Save</button>
                      <button className={btn} onClick={() => setEditing(null)}>Cancel</button>
                    </>
                  ) : (
                    <>
                      <button className={btn} onClick={() => { setEditing(t.ticketId); setDraft({ description: t.issueDescription, status: t.status }); }}>Edit</button>
                      {t.status !== "resolved" && <button className={btn} onClick={() => run(() => resolveTicket(t.ticketId))}>Resolve</button>}
                      <button className={btn} onClick={() => { if (confirm(`Delete ticket #${t.ticketId} and its vector?`)) run(() => deleteTicket(t.ticketId)); }}>Delete</button>
                    </>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <section className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold">Audit trail (filled by MySQL triggers)</h2>
          {audit.length === 0 ? (
            <p className="text-sm text-slate-500">No edits yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-slate-500"><tr><th>When</th><th>Ticket</th><th>Action</th><th>Status</th><th>By</th></tr></thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.auditId} className="border-t border-slate-100">
                    <td>{a.changedAt.slice(0, 19).replace("T", " ")}</td><td>#{a.ticketId}</td><td>{a.action}</td>
                    <td>{a.oldStatus}{a.newStatus && a.newStatus !== a.oldStatus ? ` → ${a.newStatus}` : ""}</td><td>{a.changedBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  );
}
