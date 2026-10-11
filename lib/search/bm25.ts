import type { Item } from "../types";

const STOP = new Set(
  "a an and are as at be book books by for from i in is it me my of on or that the this to was what with about some".split(" "),
);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Everything a reader might describe a book by, in one string. */
export function searchText(item: Item): string {
  return [
    item.title,
    item.series,
    item.author,
    item.category,
    ...item.subjects,
    ...item.tags,
    item.description,
    item.review,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Okapi BM25 over the shelf. Used only to narrow very large shelves before Jev ranks them,
 * so it favours recall: ties and zero scores keep their original (recent-first) order.
 */
export function bm25(query: string, items: Item[], limit: number): Item[] {
  return bm25By(query, items, searchText, limit);
}

/** BM25 over anything, given its searchable text. */
export function bm25By<T>(query: string, items: T[], text: (item: T) => string, limit: number): T[] {
  return bm25Scored(query, items, text, limit).map((s) => s.item);
}

/** As `bm25By`, with each item's score (0 when no search term appears in it). */
export function bm25Scored<T>(query: string, items: T[], text: (item: T) => string, limit: number): { item: T; score: number }[] {
  const terms = [...new Set(tokens(query))];
  if (!terms.length) return items.slice(0, limit).map((item) => ({ item, score: 0 }));

  const docs = items.map((item) => tokens(text(item)));
  const avgLength = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(docs.length, 1);
  const df = new Map<string, number>();
  for (const doc of docs) for (const t of new Set(doc)) df.set(t, (df.get(t) ?? 0) + 1);

  const k1 = 1.2;
  const b = 0.75;
  const scored = docs.map((doc, i) => {
    const tf = new Map<string, number>();
    for (const t of doc) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const term of terms) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = Math.log(1 + (docs.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.length) / avgLength)));
    }
    return { item: items[i], score, i };
  });

  return scored
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map(({ item, score }) => ({ item, score }));
}
