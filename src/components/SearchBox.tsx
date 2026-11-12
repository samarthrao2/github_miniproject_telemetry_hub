"use client";

import { useState } from "react";
import type { SearchHit } from "@/lib/search";

export default function SearchBox() {
  const [query, setQuery] = useState("Search for overheating engines in BMWs");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ brand: string | null; hits: SearchHit[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed");
      setResult(json);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="e.g. low battery voltage in Toyotas"
          className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm"
        />
        <button
          disabled={loading}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</p>}

      {result && (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Brand filter: <strong>{result.brand ?? "none (searched all brands)"}</strong> · {result.hits.length} result(s)
          </p>
          {result.hits.map((h) => (
            <article key={h.ticketId} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Ticket #{h.ticketId} · {h.vehicleId} · {h.brand} · {h.occurredAt.slice(0, 16).replace("T", " ")}</span>
                <span>similarity {h.score.toFixed(3)}</span>
              </div>
              <h3 className="mt-1 font-medium">{h.failureType} <span className="text-xs font-normal text-slate-500">({h.subsystem})</span></h3>
              <p className="mt-1 text-sm text-slate-700">{h.issueDescription}</p>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
