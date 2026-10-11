/**
 * Builds data/shelf.json from Goodreads.
 *
 *   bun run import                    # your public shelves, via shelf.config.ts → goodreadsUserId
 *   bun run import path/to/export.csv # a Goodreads "Export Library" CSV instead
 *   bun run import --refresh          # look every book up again, not just new ones
 *
 * New books are enriched from Open Library (cover, subjects, year, pages,
 * description) and get a dominant cover colour; books already on the shelf keep
 * what they had. Lookups are cached in .cache/openlibrary. The file is only
 * rewritten when something changed, so a scheduled sync makes no empty commits.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { shelfConfig } from "../shelf.config";
import { categorize } from "../lib/categories";
import { parseGoodreads, parseGoodreadsRss, STATUS } from "../lib/goodreads";
import type { Item, ShelfData } from "../lib/types";

const CACHE_DIR = ".cache/openlibrary";
const OUT = "data/shelf.json";
const CONCURRENCY = 4;
const HEADERS = { "User-Agent": "book-shelf-importer/0.1 (personal reading shelf)" };
const FEED_PAGE = 200;

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const csvPath = args.find((a) => !a.startsWith("--"));

type SearchDoc = {
  key: string;
  title: string;
  cover_i?: number;
  subject?: string[];
  first_publish_year?: number;
  number_of_pages_median?: number;
};

async function main() {
  const { items, source } = await load();
  console.log(`Read ${items.length} books from ${source}`);

  const previous = existsSync(OUT) ? (JSON.parse(await readFile(OUT, "utf8")) as ShelfData) : undefined;
  // A feed that comes back empty is far more likely a Goodreads hiccup than a deliberately emptied shelf.
  if (items.length === 0 && previous?.items.length) {
    throw new Error(`${source} has no books, but ${OUT} has ${previous.items.length}. Leaving it alone.`);
  }
  const known = new Map(refresh ? [] : previous?.items.map((i) => [i.id, i]));

  await mkdir(CACHE_DIR, { recursive: true });
  const fresh = items.filter((item) => !reuse(item, known.get(item.id)));
  let done = 0;
  let matched = 0;
  await pool(fresh, CONCURRENCY, async (item) => {
    const goodreadsCover = item.cover;
    try {
      if (await enrich(item)) matched++;
      // Open Library had no cover, so the one from Goodreads stays and needs its colour.
      if (item.cover && item.cover === goodreadsCover) item.color = (await coverColor(item.cover)) ?? item.color;
    } catch (error) {
      console.warn(`  skipped enrichment for "${item.title}": ${(error as Error).message}`);
    }
    if (item.description) item.description = cleanDescription(item.description);
    if (++done % 10 === 0 || done === fresh.length) console.log(`  ${done}/${fresh.length}`);
  });
  for (const item of items) item.category = categorize(item);

  if (previous && JSON.stringify(previous.items) === JSON.stringify(items)) {
    console.log(`No changes; ${OUT} left as it was.`);
    return;
  }
  const data: ShelfData = { updatedAt: new Date().toISOString(), items };
  await writeFile(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`Wrote ${OUT}: ${items.length} books, ${fresh.length} looked up, ${matched} matched on Open Library.`);
}

async function load(): Promise<{ items: Item[]; source: string }> {
  if (csvPath) {
    if (!existsSync(csvPath)) throw new Error(`No file at ${csvPath}.`);
    return { items: parseGoodreads(await readFile(csvPath, "utf8")), source: csvPath };
  }
  const user = shelfConfig.goodreadsUserId;
  if (!user) throw new Error("Set goodreadsUserId in shelf.config.ts, or pass a Goodreads CSV: bun run import path/to.csv");

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
  return { items, source: `Goodreads user ${user}` };
}

/** Carries over what an earlier run looked up, so only new books hit Open Library. */
function reuse(item: Item, before: Item | undefined): boolean {
  if (!before) return false;
  item.openLibraryKey = before.openLibraryKey;
  item.subjects = before.subjects;
  item.cover = before.cover ?? item.cover;
  item.color = before.color;
  item.description = before.description ?? item.description;
  item.year ??= before.year;
  item.pages ??= before.pages;
  return true;
}

async function enrich(item: Item): Promise<boolean> {
  const doc = await findOnOpenLibrary(item);
  if (!doc) return false;

  item.openLibraryKey = doc.key;
  item.year ??= doc.first_publish_year;
  item.pages ??= doc.number_of_pages_median;
  item.subjects = cleanSubjects(doc.subject ?? []);

  if (doc.cover_i) {
    item.cover = `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`;
    const color = await coverColor(`https://covers.openlibrary.org/b/id/${doc.cover_i}-S.jpg`);
    if (color) item.color = color;
  }

  const work = await getJson<{ description?: string | { value: string } }>(`https://openlibrary.org${doc.key}.json`);
  const description = typeof work?.description === "string" ? work.description : work?.description?.value;
  if (description) item.description = cleanDescription(description);
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
    const res = await getJson<{ docs: SearchDoc[] }>(
      `https://openlibrary.org/search.json?${q}&fields=${fields}&limit=5`,
    );
    return res?.docs ?? [];
  }
}

function normalize(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const NOISE = /^(accessible book|protected daisy|in library|lending library|large type books|open library staff picks|nyt:|new york times|reading level|fiction, general)/i;

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

const coverColor = (url: string) => memo(`color:${url}`, () => dominantColor(url));

/** Average colour of the heaviest colour bucket. */
async function dominantColor(url: string): Promise<string | undefined> {
  const res = await fetchWithRetry(url);
  if (!res.ok) return undefined;
  const { data } = await sharp(Buffer.from(await res.arrayBuffer()))
    .resize(24, 36, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 3) {
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
  return memo(url, async () => {
    const res = await fetchWithRetry(url);
    return res.ok ? ((await res.json()) as T) : undefined;
  });
}

/** Caches a JSON-serialisable result on disk, keyed by `key`. Failures (throws) are not cached. */
async function memo<T>(key: string, load: () => Promise<T | undefined>): Promise<T | undefined> {
  const file = `${CACHE_DIR}/${createHash("sha1").update(key).digest("hex")}.json`;
  if (existsSync(file)) return JSON.parse(await readFile(file, "utf8")).value as T | undefined;
  const value = await load();
  await writeFile(file, JSON.stringify({ key, value: value ?? null }));
  return value;
}

/** Retries rate limits, server errors and network failures; throws when it gives up. */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status !== 429 && res.status < 500) return res;
    } catch {
      // Network hiccup; retry below.
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
