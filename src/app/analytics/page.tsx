import AnalyticsRunner from "@/components/AnalyticsRunner";
import { ANALYTICS } from "@/lib/analytics-queries";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireSession();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">SQL Analytics</h1>
      <p className="text-sm text-slate-600">
        Advanced MySQL features running live against the fleet data: CTEs, recursive CTE, correlated and nested
        subqueries, window functions, JSON, a view, a stored procedure and a stored function.
      </p>
      <AnalyticsRunner queries={ANALYTICS.map(({ key, title, concept, sql }) => ({ key, title, concept, sql }))} />
    </div>
  );
}
