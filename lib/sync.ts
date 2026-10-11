import "server-only";
import jpeg from "jpeg-js";
import { shelfConfig } from "@/shelf.config";
import { categorize } from "./categories";
import { getStoredBooks, replaceShelf, type StoredBook } from "./data";
import { parseGoodreadsRss, STATUS } from "./goodreads";
import type { Item } from "./types";

/**
 * The Goodreads sync: reads the owner's public shelves (RSS), keeps what earlier syncs looked up
 * on Open Library, looks up new books, and replaces the shelf in D1 when anything changed.
 * Runs from the Sync button and nightly (worker.ts).
 */

const FEED_PAGE = 200;
/** Open Library lookups per sync; a big first import fills in over a few syncs. */
const MAX_LOOKUPS = 25;
const CONCURRENCY = 4;
const HEADERS = { "User-Agent": "book-shelf/0.1 (personal reading shelf)" };

export type SyncResult = {
  books: number;
  added: string[];
  removed: string[];
  /** Books whose details changed (rating, shelf, review…), not counting added ones. */
  updated: number;
  /** New books still waiting for an Open Library lookup (done on the next syncs). */
  pending: number;
  changed: boolean;
};

export async function syncGoodreads(): Promise<SyncResult> {
  const user = shelfConfig.goodreadsUserId;
  if (!user) throw new Error("Set goodreadsUserId in shelf.config.ts.");

  const [items, stored] = await Promise.all([fetchShelves(user), getStoredBooks()]);
  // A feed that comes back empty is far more likely a Goodreads hiccup than a deliberately emptied shelf.
  if (items.length === 0 && stored.length) throw new Error("Goodreads returned no books, so the shelf was left alone.");
  const before = new Map(stored.map((b) => [b.item.id, b]));

  const fresh = items.filter((item) => !before.get(item.id)?.lookedUp);
  const toLookUp = new Set(fresh.slice(0, MAX_LOOKUPS).map((i) => i.id));
  await pool(
    items.filter((i) => toLookUp.has(i.id)),
    CONCURRENCY,
    async (item) => {
      const goodreadsCover = item.cover;
      try {
        await enrich(item);
        // Open Library had no cover, so Goodreads' stays and needs its colour.
        if (item.cover && item.cover === goodreadsCover) item.color = (await dominantColor(item.cover)) ?? item.color;
      } catch (error) {
        console.warn(`Open Library lookup failed for "${item.title}": ${(error as Error).message}`);
      }
    },
  );

  const rows: StoredBook[] = items.map((item) => {
    const old = before.get(item.id);
    if (toLookUp.has(item.id)) {
      if (item.description) item.description = cleanDescription(item.description);
    } else if (old) {
      reuse(item, old.item);
    } else if (item.description) {
      item.description = cleanDescription(item.description);
    }
    item.category = categorize(item);
    return { item, lookedUp: toLookUp.has(item.id) || Boolean(old?.lookedUp) };
  });

  const ids = new Set(items.map((i) => i.id));
  const result: SyncResult = {
    books: items.length,
    added: items.filter((i) => !before.has(i.id)).map((i) => i.title),
    removed: stored.filter((b) => !ids.has(b.item.id)).map((b) => b.item.title),
    updated: rows.filter((r) => before.has(r.item.id) && JSON.stringify(r.item) !== JSON.stringify(before.get(r.item.id)!.item)).length,
    pending: Math.max(0, fresh.length - toLookUp.size),
    changed: false,
  };
  const sameOrder = stored.length === rows.length && stored.every((b, i) => b.item.id === rows[i].item.id);
  const sameLookups = rows.every((r) => before.get(r.item.id)?.lookedUp === r.lookedUp);
  result.changed = !(sameOrder && sameLookups && result.added.length === 0 && result.updated === 0);
  if (result.changed) await replaceShelf(rows, new Date().toISOString());
  return result;
}

/** Every book on the read, currently-reading and to-read shelves. */
async function fetchShelves(user: string): Promise<Item[]> {
  const items: Item[] = [];
  for (const [shelf, status] of Object.entries(STATUS)) {
    for (let page = 1; ; page++) {
      const url = `https://www.goodreads.com/review/list_rss/${user}?shelf=${shelf}&per_page=${FEED_PAGE}&page=${page}`;
      const res = await fetchWithRetry(url);
      if (!res.ok) {
        throw new Error(`Goodreads answered ${res.status} for the "${shelf}" shelf. Is the profile public and the user id right?`);
      }
      const batch = parseGoodreadsRss(await res.text(), status);
      items.push(...batch);
      if (batch.length < FEED_PAGE) break;
    }
  }
  return items;
}

/** Carries over what an earlier sync looked up, so only new books hit Open Library. */
function reuse(item: Item, before: Item) {
  item.openLibraryKey = before.openLibraryKey;
  item.subjects = before.subjects;
  item.cover = before.cover ?? item.cover;
  item.color = before.color;
  item.description = before.description;
  item.year ??= before.year;
  item.pages ??= before.pages;
}

// ---- Open Library ------------------------------------------------------------------------------

type SearchDoc = {
  key: string;
  title: string;
  cover_i?: number;
  subject?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
};

async function enrich(item: Item): Promise<boolean> {
  const doc = await findOnOpenLibrary(item);
  if (!doc) return false;

  item.openLibraryKey = doc.key;
  item.year ??= doc.first_publish_year;
  item.pages ??= doc.number_of_pages_median;
  item.subjects = cleanSubjects(doc.subject ?? []);

  if (doc.cover_i) {
    item.cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    const color = await dominantColor(`https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg`);
    if (color) item.color = color;
  }

  const work = await getJson<{ description?: string | { value: string } }>(`https://openlibrary.org${doc.key}.json`);
  const description = typeof work?.description === "string" ? work.description : work?.description?.value;
  if (description) item.description = description;
  return true;
}

async function findOnOpenLibrary(item: Item): Promise<SearchDoc | undefined> {
  const fields = "key,title,cover_i,subject,first_publish_year,number_of_pages_median";
  const enc = encodeURIComponent;
  // "The Sandman, Vol. 1: Preludes & Nocturnes" may be listed as the whole thing,
  // as "The Sandman", or as "Preludes & Nocturnes".
  const shortTitle = item.title.split(/[:,(]/)[0].trim();
  const subtitle = item.title.split(":")[1]?.trim();
  const forms = new Set([item.title, shortTitle, subtitle].filter(Boolean).map((t) => normalize(t as string)));

  const byTitle = [
    item.isbn && `isbn=${item.isbn}`,
    ...[item.title, shortTitle, subtitle]
      .filter((t, i, all) => t && all.indexOf(t) === i)
      .map((t) => `title=${enc(t as string)}&author=${enc(item.author)}`),
  ].filter(Boolean) as string[];

  // Results include sequels and box sets that merely mention the title, so only exact titles count.
  // A match with a cover beats one without: the first match is sometimes a coverless stub.
  let coverless: SearchDoc | undefined;
  for (const q of byTitle) {
    const exact = (await search(q)).filter((d) => forms.has(normalize(d.title)));
    const withCover = exact.find((d) => d.cover_i);
    if (withCover) return withCover;
    coverless ??= exact[0];
  }
  if (coverless) return coverless;

  // Last resort: free text, which finds books listed under their original-language title
  // (海辺のカフカ). Only the top hit is trusted, and only with a cover; a generated cover beats a wrong one.
  const [top] = await search(`q=${enc(`${shortTitle} ${item.author}`)}`);
  return top?.cover_i ? top : undefined;

  async function search(q: string): Promise<SearchDoc[]> {
    const res = await getJson<{ docs: SearchDoc[] }>(`https://openlibrary.org/search.json?${q}&fields=${fields}&limit=5`);
    return res?.docs ?? [];
  }
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const NOISE =
  /^(accessible book|protected daisy|in library|lending library|large type books|open library staff picks|nyt:|new york times|reading level|fiction, general)/i;

function cleanSubjects(subjects: string[]): string[] {
  const seen = new Set<string>();
  return subjects
    .map((s) => s.trim())
    .filter((s) => {
      const key = s.toLowerCase();
      if (NOISE.test(s) || s.length > 40 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
}

function cleanDescription(text: string): string {
  const body = text
    .split(/\n\s*-{3,}|\(\[source\]|\[source\]/i)[0]
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (body.length <= 520) return body;
  const cut = body.slice(0, 520);
  const end = cut.lastIndexOf(". ");
  return end > 200 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Average colour of the heaviest colour bucket of a cover (a small JPEG). */
async function dominantColor(url: string): Promise<string | undefined> {
  const res = await fetchWithRetry(url);
  if (!res.ok) return undefined;
  let data: Uint8Array;
  try {
    // A pure-JS decoder: Workers can't run native image libraries.
    ({ data } = jpeg.decode(new Uint8Array(await res.arrayBuffer()), { useTArray: true, maxMemoryUsageInMB: 64 }));
  } catch {
    return undefined;
  }

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  // RGBA; every other pixel is plenty for a cover's main colour.
  for (let i = 0; i < data.length; i += 8) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const [max, min] = [Math.max(r, g, b), Math.min(r, g, b)];
    // Favour saturated pixels; near-black and near-white are mostly text and margins.
    const weight = (1 + (max - min) / 40) * (max < 48 || min > 220 ? 0.3 : 1);
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  const top = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
  if (!top) return undefined;
  return `#${[top.r, top.g, top.b].map((v) => Math.round(v / top.n).toString(16).padStart(2, "0")).join("")}`;
}

async function getJson<T>(url: string): Promise<T | undefined> {
  const res = await fetchWithRetry(url);
  return res.ok ? ((await res.json()) as T) : undefined;
}

/** Retries rate limits, server errors and network failures; throws when it gives up. */
async function fetchWithRetry(url: string, attempts = 3): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      // Network hiccup; retry below.
    }
    await new Promise((r) => setTimeout(r, 800 * 2 ** i));
  }
  throw new Error(`gave up on ${url}`);
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}
