import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchFailures } from "@/lib/search";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as
    | { query?: string; brand?: string | null; limit?: number }
    | null;
  const query = body?.query?.trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });

  try {
    const result = await searchFailures({
      role: session.role,
      query,
      brand: body?.brand || null,
      limit: Math.min(Math.max(body?.limit ?? 5, 1), 20),
    });
    return NextResponse.json(result);
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Search failed. Are MySQL and Qdrant running and seeded?" }, { status: 500 });
  }
}
