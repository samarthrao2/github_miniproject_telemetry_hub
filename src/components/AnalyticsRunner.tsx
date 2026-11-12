"use client";

import { useState, useTransition } from "react";
import { runAnalytics, type AnalyticsResult } from "@/app/analytics-actions";
import type { AnalyticsQuery } from "@/lib/analytics-queries";

export default function AnalyticsRunner({ queries }: { queries: AnalyticsQuery[] }) {
  const [results, setResults] = useState<Record<string, AnalyticsResult>>({});
  const [pending, start] = useTransition();
  const [running, setRunning] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      {queries.map((q) => {
        const r = results[q.key];
        return (
          <section key={q.key} className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">{q.title}</h2>
                <p className="text-xs text-slate-500">{q.concept}</p>
              </div>
              <button
                disabled={pending}
                onClick={() => { setRunning(q.key); start(async () => { const res = await runAnalytics(q.key); setResults((p) => ({ ...p, [q.key]: res })); }); }}
                className="rounded bg-slate-900 px-3 py-1 text-xs text-white disabled:opacity-50"
              >
                {pending && running === q.key ? "Running…" : "Run"}
              </button>
            </div>
            <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-xs">{q.sql}</pre>
            {r && ("error" in r ? (
              <p className="mt-2 text-sm text-red-700">{r.error}</p>
            ) : (
              <div className="mt-2 max-h-72 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-slate-500"><tr>{r.columns.map((c) => <th key={c} className="pr-3">{c}</th>)}</tr></thead>
                  <tbody>
                    {r.rows.map((row, i) => (
                      <tr key={i} className="border-t border-slate-100">{row.map((v, j) => <td key={j} className="pr-3">{v ?? "—"}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
                {r.rows.length === 0 && <p className="text-xs text-slate-500">No rows.</p>}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
