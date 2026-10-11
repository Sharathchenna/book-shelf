import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { db } from "../db";
import type { SearchDoc } from "./site";

/**
 * The search index: an embedding of every book and clipping in Cloudflare Vectorize, made with
 * Workers AI. A search embeds the query and asks for the nearest documents, which Jev then
 * ranks; this is how search finds things by meaning in a collection too big for Jev to read
 * whole. The embeddings table in D1 remembers what was embedded, so a document is embedded
 * again only when its text changes. Everything here is optional: without the bindings (or
 * when a call fails), search narrows by keywords instead.
 */

const MODEL = "@cf/qwen/qwen3-embedding-0.6b";
/** Texts per Workers AI call. */
const BATCH = 25;

type Index = { ai: Ai; vectors: VectorizeIndex; namespace: string };

async function searchIndex(): Promise<Index | null> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.AI || !env.VECTORIZE) return null;
  return { ai: env.AI, vectors: env.VECTORIZE, namespace: env.SEARCH_NAMESPACE ?? process.env.SEARCH_NAMESPACE ?? "site" };
}

/** Vector ids are unique across the whole index, so another namespace's ids carry its name. */
const vectorId = (index: Index, docId: string) => (index.namespace === "site" ? docId : `${index.namespace}:${docId}`);
const docIdOf = (index: Index, id: string) => (index.namespace === "site" ? id : id.slice(index.namespace.length + 1));

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${MODEL}\n${text}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/**
 * Embeds the documents whose text changed since they were last embedded. With `prune`, `docs`
 * is everything on the site, and documents no longer in it leave the index.
 */
export async function indexDocs(docs: SearchDoc[], { prune = false } = {}): Promise<{ embedded: number; removed: number } | null> {
  const index = await searchIndex();
  if (!index) return null;
  const database = await db();
  const { results } = await database.prepare("SELECT doc_id, hash FROM embeddings").all<{ doc_id: string; hash: string }>();
  const known = new Map(results.map((row) => [row.doc_id, row.hash]));

  const hashes = await Promise.all(docs.map((doc) => hash(doc.passage)));
  const stale = docs.map((doc, i) => ({ doc, hash: hashes[i] })).filter(({ doc, hash }) => known.get(doc.id) !== hash);
  const now = new Date().toISOString();
  for (let i = 0; i < stale.length; i += BATCH) {
    const slice = stale.slice(i, i + BATCH);
    const { data } = await index.ai.run(MODEL, { documents: slice.map(({ doc }) => doc.passage) });
    await index.vectors.upsert(slice.map(({ doc }, j) => ({ id: vectorId(index, doc.id), values: data[j], namespace: index.namespace })));
    await database.batch(
      slice.map(({ doc, hash }) =>
        database
          .prepare("INSERT INTO embeddings (doc_id, hash, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (doc_id) DO UPDATE SET hash = ?2, updated_at = ?3")
          .bind(doc.id, hash, now),
      ),
    );
  }

  let removed = 0;
  if (prune) {
    const present = new Set(docs.map((doc) => doc.id));
    const gone = [...known.keys()].filter((id) => !present.has(id));
    if (gone.length) await removeDocs(gone);
    removed = gone.length;
  }
  return { embedded: stale.length, removed };
}

export async function removeDocs(ids: string[]): Promise<void> {
  const index = await searchIndex();
  if (!index || !ids.length) return;
  const database = await db();
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    await index.vectors.deleteByIds(slice.map((id) => vectorId(index, id)));
    await database.batch(slice.map((id) => database.prepare("DELETE FROM embeddings WHERE doc_id = ?1").bind(id)));
  }
}

/** The ids of the documents nearest the query, best first, or null without an index. */
export async function nearest(query: string, topK: number): Promise<{ id: string; score: number }[] | null> {
  const index = await searchIndex();
  if (!index) return null;
  const { data } = await index.ai.run(MODEL, { queries: query });
  const { matches } = await index.vectors.query(data[0], { topK, namespace: index.namespace });
  return matches.map(({ id, score }) => ({ id: docIdOf(index, id), score }));
}
