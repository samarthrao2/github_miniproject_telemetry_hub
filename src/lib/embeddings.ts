import "dotenv/config";

// Provider is chosen by env so no credentials live in code.
//   local  -> Transformers.js (all-MiniLM-L6-v2, 384 dims), no API key
//   openai -> text-embedding-3-small (1536 dims)
const provider = (process.env.EMBEDDING_PROVIDER ?? "local").toLowerCase();

export const EMBEDDING_DIM =
  provider === "openai" ? 1536 : Number(process.env.LOCAL_EMBEDDING_DIM ?? 384);

type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const g = globalThis as unknown as { __extractor?: Promise<Extractor> };

function localExtractor(): Promise<Extractor> {
  return (g.__extractor ??= import("@huggingface/transformers").then(
    (m) =>
      m.pipeline(
        "feature-extraction",
        process.env.LOCAL_EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2",
      ) as unknown as Promise<Extractor>,
  ));
}

export async function embedMany(texts: string[]): Promise<number[][]> {
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error("OPENAI_API_KEY is required when EMBEDDING_PROVIDER=openai");
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embeddings failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
  const extract = await localExtractor();
  const out = await extract(texts, { pooling: "mean", normalize: true });
  return out.tolist();
}

export async function embed(text: string): Promise<number[]> {
  return (await embedMany([text]))[0];
}
