import SearchBox from "@/components/SearchBox";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  await requireSession();
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Predictive Maintenance Search</h1>
      <p className="text-sm text-slate-600">
        Describe a failure in plain language. If a brand is mentioned (e.g. &ldquo;BMWs&rdquo;), Qdrant filters
        on that brand first, then ranks by cosine similarity.
      </p>
      <SearchBox />
    </div>
  );
}
