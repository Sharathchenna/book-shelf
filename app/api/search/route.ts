import { APIError } from "@typesafe-ai/sdk";
import { jevEnabled, rankForSearch } from "@/lib/ai/jev";
import { getClippings, getShelf } from "@/lib/data";
import { bm25By, bm25Scored } from "@/lib/search/bm25";
import { bookDoc, clipDoc, type SearchDoc } from "@/lib/search/site";
import { nearest } from "@/lib/search/vectors";

/** Everything is ranked when there's this little; more is narrowed first, by meaning and keywords. */
const RANK_ALL_UP_TO = 150;
const CANDIDATES = 100;
/** Keyword matches added to the nearest documents, for exact names and handles embeddings can blur. */
const KEYWORD_EXTRAS = 20;
const RESULTS = 20;
/** Jev's probability below which a result isn't shown (unless nothing scores higher). */
const MIN_MATCH = 0.2;

const RATE = { windowMs: 60_000, max: 40 };
const hits = new Map<string, number[]>();
const cache = new Map<string, SearchResult[]>();

type Shown = Omit<SearchDoc, "card" | "text" | "passage">;
type SearchResult = Shown & { match: number };

/**
 * Searches the whole site (books, papers, articles, newsletter issues, tweets) by meaning. Large
 * collections are first narrowed to the documents nearest the search in the vector index
 * (lib/search/vectors.ts) plus the best keyword matches; then Jev judges each candidate against
 * the search. Without Jev, the vector (or else keyword) ranking is the answer.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 200) : "";
  if (query.length < 2) return Response.json({ results: [] });

  const ip = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  hits.set(ip, [...recent, now]);
  if (recent.length >= RATE.max) return Response.json({ error: "Too many searches. Try again in a minute." }, { status: 429 });

  const [shelf, { items: clips }] = await Promise.all([getShelf(), getClippings()]);
  // A sync or a new clipping changes the answer, so the cache key carries both.
  const key = `${shelf.updatedAt}:${clips.length}:${clips[0]?.id ?? ""}:${query.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return Response.json({ results: cached, ranked: true, cached: true });

  const docs = [...shelf.items.map(bookDoc), ...clips.map(clipDoc)];
  const byDocId = new Map(docs.map((d) => [d.id, d]));
  const near =
    docs.length > RANK_ALL_UP_TO || !jevEnabled()
      ? await nearest(query, CANDIDATES).catch((error) => {
          console.error("Vector search failed; narrowing by keywords", error);
          return null;
        })
      : null;
  const pool =
    docs.length <= RANK_ALL_UP_TO
      ? docs
      : near
        ? [
            ...new Set([
              ...near.map((n) => byDocId.get(n.id)).filter((d): d is SearchDoc => Boolean(d)),
              ...bm25By(query, docs, (d) => d.text, KEYWORD_EXTRAS),
            ]),
          ]
        : bm25By(query, docs, (d) => d.text, CANDIDATES);
  // The palette needs none of what the rankers read.
  const strip = (doc: SearchDoc): Shown => {
    const { id, kind, title, subtitle, image, href, paperId, articleId } = doc;
    return { id, kind, title, subtitle, image, href, paperId, articleId };
  };

  if (!jevEnabled() && near) {
    // Nearest first, with the cosine similarity as the match.
    const found = near.filter((n) => byDocId.has(n.id)).slice(0, RESULTS);
    return Response.json({ results: found.map((n) => ({ ...strip(byDocId.get(n.id)!), match: Math.max(0, Math.min(1, n.score)) })), ranked: true });
  }
  if (!jevEnabled()) {
    // Only what contains a search word, scored against the best match.
    const scored = bm25Scored(query, docs, (d) => d.text, RESULTS).filter((s) => s.score > 0);
    const best = scored[0]?.score ?? 1;
    const results = scored.map(({ item, score }) => ({ ...strip(item), match: score / best }));
    return Response.json({ results, ranked: false });
  }

  const started = performance.now();
  let ranked;
  try {
    ranked = await rankForSearch(pool.map((d) => ({ id: d.id, card: d.card })), query);
  } catch (error) {
    console.error("Search ranking failed", error);
    const status = error instanceof APIError && error.status === 429 ? 429 : 502;
    return Response.json({ error: "Search is having a moment. Try again shortly." }, { status });
  }
  const byId = new Map(pool.map((d) => [d.id, d]));
  const top = ranked.slice(0, RESULTS);
  const shown = top.filter((r) => r.match >= MIN_MATCH);
  const results = (shown.length ? shown : top.slice(0, 3)).map((r) => ({ ...strip(byId.get(r.id)!), match: r.match }));

  cache.set(key, results);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  return Response.json({ results, ranked: true, ms: Math.round(performance.now() - started) });
}
