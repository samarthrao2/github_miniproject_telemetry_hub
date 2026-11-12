import { eq, inArray } from "drizzle-orm";
import { dbFor, type Role } from "@/db";
import { fleetAssets, maintenanceTickets } from "@/db/schema";
import { embed } from "./embeddings";
import { COLLECTION, qdrant } from "./qdrant";

export type SearchHit = {
  score: number;
  ticketId: number;
  vehicleId: string;
  brand: string;
  failureType: string;
  subsystem: string;
  status: string;
  issueDescription: string;
  occurredAt: string;
};

/** Finds a known brand mentioned in free text ("BMWs", "mercedes benz", "audi's"). */
export function detectBrand(query: string, brands: string[]): string | null {
  const q = query.toLowerCase();
  for (const b of brands) {
    const name = b.toLowerCase();
    const loose = name.replace(/[-\s]+/g, "[-\\s]?");
    if (new RegExp(`\\b${loose}('?s)?\\b`).test(q)) return b;
    if (name.includes("-") && new RegExp(`\\b${name.split("-")[0]}('?s)?\\b`).test(q)) return b;
  }
  return null;
}

export async function searchFailures(opts: {
  role: Role;
  query: string;
  brand?: string | null;
  limit?: number;
}): Promise<{ brand: string | null; hits: SearchHit[] }> {
  const { db } = dbFor(opts.role);
  const brands = (await db.selectDistinct({ brand: fleetAssets.brand }).from(fleetAssets)).map((r) => r.brand);
  const brand = opts.brand || detectBrand(opts.query, brands);

  const vector = await embed(opts.query);
  const { points } = await qdrant.query(COLLECTION, {
    query: vector,
    limit: opts.limit ?? 5,
    with_payload: false,
    // Payload filter is applied inside the ANN search, before cosine ranking.
    filter: brand ? { must: [{ key: "brand", match: { value: brand } }] } : undefined,
  });

  const ids = points.map((p) => Number(p.id));
  if (!ids.length) return { brand, hits: [] };

  const rows = await db
    .select({
      ticketId: maintenanceTickets.ticketId,
      issueDescription: maintenanceTickets.issueDescription,
      failureType: maintenanceTickets.failureType,
      subsystem: maintenanceTickets.subsystem,
      status: maintenanceTickets.status,
      occurredAt: maintenanceTickets.occurredAt,
      vehicleId: fleetAssets.vehicleId,
      brand: fleetAssets.brand,
    })
    .from(maintenanceTickets)
    .innerJoin(fleetAssets, eq(fleetAssets.assetId, maintenanceTickets.assetId))
    .where(inArray(maintenanceTickets.ticketId, ids));

  const byId = new Map(rows.map((r) => [r.ticketId, r]));
  const hits = points.flatMap((p) => {
    const r = byId.get(Number(p.id));
    return r ? [{ ...r, occurredAt: r.occurredAt.toISOString(), score: p.score }] : [];
  });
  return { brand, hits };
}
