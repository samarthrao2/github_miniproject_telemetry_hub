import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";

export const COLLECTION = process.env.QDRANT_COLLECTION ?? "failure_reports";

export const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL ?? "http://localhost:6333",
  apiKey: process.env.QDRANT_API_KEY || undefined,
  checkCompatibility: false, // avoids a server round-trip at import/build time
});
