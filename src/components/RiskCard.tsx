import type { ReadingRisk, RiskAssessment, RiskLevel } from "@/lib/risk";

const STYLE: Record<RiskLevel, string> = {
  normal: "bg-emerald-100 text-emerald-800",
  low: "bg-slate-100 text-slate-700",
  medium: "bg-amber-100 text-amber-800",
  high: "bg-red-100 text-red-800",
};

const when = (iso: string) => iso.slice(5, 16).replace("T", " ");

function Badge({ level }: { level: RiskLevel }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${STYLE[level]}`}>{level}</span>;
}

function Neighbours({ r }: { r: ReadingRisk }) {
  if (!r.neighbours.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
      {r.neighbours.map((n) => (
        <li key={n.ticketId}>
          Similar to past <strong>{n.failureType}</strong> ({n.brand} {n.vehicleId}, ticket #{n.ticketId}), similarity{" "}
          {n.score.toFixed(2)}
        </li>
      ))}
    </ul>
  );
}

export default function RiskCard({ risk, loading }: { risk: RiskAssessment | null; loading: boolean }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 ${loading ? "opacity-60" : ""}`}>
      <h2 className="text-sm font-semibold">Failure risk (nearest-neighbour, demonstration)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Each recent reading with an anomaly is described in words, embedded, and compared in Qdrant with the 35
        historical failures. This is similarity scoring, not a trained forecasting model, so treat it as a hint.
        Readings that already produced a ticket match their own ticket (very high similarity).
      </p>
      {!risk ? (
        <p className="text-sm text-slate-500">No risk data.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 text-sm">
              <span>Latest reading ({when(risk.latest!.timestamp)}):</span>
              <Badge level={risk.latest!.level} />
            </div>
            {risk.latest!.signals.length ? (
              <>
                <p className="mt-1 text-xs text-slate-700">Signals: {risk.latest!.signals.join("; ")}</p>
                <Neighbours r={risk.latest!} />
              </>
            ) : (
              <p className="mt-1 text-xs text-slate-500">No anomaly signals in the latest reading.</p>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-slate-700">
              Other flagged readings in the last {risk.window} (top {risk.flagged.length})
            </h3>
            {risk.flagged.length === 0 ? (
              <p className="text-xs text-slate-500">None: no other anomalous readings in this window.</p>
            ) : (
              <table className="mt-1 w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr><th>When</th><th>Risk</th><th>Signals</th><th>Closest past failure</th></tr>
                </thead>
                <tbody>
                  {risk.flagged.map((f) => (
                    <tr key={f.logId} className="border-t border-slate-100 align-top">
                      <td className="whitespace-nowrap pr-2">{when(f.timestamp)}</td>
                      <td className="pr-2"><Badge level={f.level} /></td>
                      <td className="pr-2">{f.signals.join("; ")}</td>
                      <td>
                        {f.neighbours[0]
                          ? `${f.neighbours[0].failureType} (${f.neighbours[0].score.toFixed(2)})`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
