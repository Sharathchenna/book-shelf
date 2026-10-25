import "server-only";
import { shelve, SHELVE_BATCH, type Shelvable } from "./ai/shelver";
import { haikuEnabled } from "./ai/haiku";
import { topicOf, type ShelfBook, type Shelving, type TopicKey } from "./bookcase";
import { readableClip } from "./clippings";
import { getClippings, getShelf } from "./data";
import { batched, db, records } from "./db";
import { listFiles, shelfItemFor } from "./library";
import type { LibraryBook } from "./library-types";
import type { Clip, Item } from "./types";

/** The books and clippings in the owner's Trash, or only opened from their Feed (lib/triage.ts). */
async function trashedIds(): Promise<Set<string>> {
  const { results } = await (await db()).prepare("SELECT id FROM triage WHERE trashed_at IS NOT NULL OR place = 'feed'").all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

/**
 * The bookcase on the home page (lib/bookcase.ts, app/components/bookcase/): where each book and
 * clipping is shelved (the `shelving` table), and the shelf as the page draws it.
 */

export async function getShelving(): Promise<Map<string, Shelving>> {
  const { results } = await (await db())
    .prepare("SELECT id, topic, tags, favorite, manual FROM shelving")
    .all<{ id: string; topic: string; tags: string; favorite: number | null; manual: number }>();
  return new Map(
    results.map((row) => [
      row.id,
      {
        topic: topicOf(row.topic),
        tags: JSON.parse(row.tags) as string[],
        ...(row.favorite === null ? {} : { favorite: row.favorite === 1 }),
        ...(row.manual ? { manual: true } : {}),
      },
    ]),
  );
}

/** The owner moves a book to another topic, or stars it. A topic chosen here is never chosen again by Haiku. */
export async function setShelving(id: string, patch: { topic?: TopicKey; favorite?: boolean }) {
  const now = new Date().toISOString();
  const database = await db();
  await database
    .prepare(
      `INSERT INTO shelving (id, topic, tags, favorite, manual, at) VALUES (?1, ?2, '[]', ?3, ?4, ?5)
       ON CONFLICT (id) DO UPDATE SET topic = COALESCE(?6, topic), favorite = COALESCE(?3, favorite), manual = MAX(manual, ?4), at = ?5`,
    )
    .bind(id, patch.topic ?? "unsorted", patch.favorite === undefined ? null : patch.favorite ? 1 : 0, patch.topic ? 1 : 0, now, patch.topic ?? null)
    .run();
}

export async function removeShelving(id: string) {
  await (await db()).prepare("DELETE FROM shelving WHERE id = ?1").bind(id).run();
}

let shelving: Promise<number> | null = null;

/**
 * Shelves whatever isn't on a topic yet: everything at first, then each new book or clipping.
 * Runs after a sync, after a save, and after the home page is served while anything is unsorted
 * (which passes the database it already has: after the response, `db()` can't be called).
 * Returns how many were shelved; one run at a time.
 */
export function shelveMissing(given?: D1Database): Promise<number> {
  if (!haikuEnabled()) return Promise.resolve(0);
  shelving ??= (async () => {
    const database = given ?? (await db());
    const [books, clips, known] = await database.batch([
      database.prepare("SELECT data FROM books"),
      database.prepare("SELECT data FROM clippings"),
      database.prepare("SELECT id FROM shelving"),
    ]);
    const have = new Set((known.results as { id: string }[]).map((row) => row.id));
    const missing = [
      ...records<Item>(books.results as { data: string }[]).map(bookAbout),
      ...records<Clip>(clips.results as { data: string }[]).map(clipAbout),
    ].filter((x) => !have.has(x.id));
    let done = 0;
    for (let i = 0; i < missing.length; i += SHELVE_BATCH) {
      const placed = await shelve(missing.slice(i, i + SHELVE_BATCH));
      const now = new Date().toISOString();
      await batched(
        database,
        [...placed].map(([id, s]) =>
          database
            .prepare("INSERT INTO shelving (id, topic, tags, manual, at) VALUES (?1, ?2, ?3, 0, ?4) ON CONFLICT (id) DO NOTHING")
            .bind(id, s.topic, JSON.stringify(s.tags), now),
        ),
      );
      done += placed.size;
    }
    return done;
  })().finally(() => (shelving = null));
  return shelving;
}

const clean = (s: string | undefined, max: number) => (s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function bookAbout(item: Item): Shelvable {
  return {
    id: item.id,
    about: [
      `Book: ${item.title}${item.author ? ` by ${item.author}` : ""}${item.year ? ` (${item.year})` : ""}`,
      item.subjects.length && `Subjects: ${item.subjects.slice(0, 10).join(", ")}`,
      item.tags.length && `The reader's shelves: ${item.tags.join(", ")}`,
      item.description && clean(item.description, 400),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function clipAbout(clip: Clip): Shelvable {
  const what = { article: "Article", paper: "Research paper", newsletter: "Newsletter issue", tweet: "Post on X", video: "Video", podcast: "Podcast episode" }[clip.kind];
  return {
    id: clip.id,
    about: [
      `${what}: ${clip.title ?? clean(clip.tweet?.text, 300)}${clip.author ? ` by ${clip.author}` : clip.tweet ? ` by @${clip.tweet.handle}` : ""}`,
      `Source: ${clip.source}`,
      clean(clip.paper?.pwc?.tldr ?? clip.excerpt, 400),
      clip.enriched?.summary,
      clip.enriched?.topics.length && `Topics: ${clip.enriched.topics.join(", ")}`,
      clip.paper?.pwc?.tasks.length && `Tasks: ${clip.paper.pwc.tasks.map((t) => t.name).join(", ")}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

// ---- the shelf as the page draws it ------------------------------------------------------------

/** Reading pace for minutes from a file's length: about 5 characters a word, 230 words a minute. */
const CHARS_PER_MINUTE = 1150;

/**
 * Everything on the bookcase, for anyone: no reading progress, which the owner's browser adds
 * (/api/me); and nothing the owner has put in the Trash or only opened from their Feed, unless
 * asked for (the app, which has its Trash and its Feed).
 */
export async function shelfBooks({ trashed = false } = {}): Promise<{ books: ShelfBook[]; unsorted: number }> {
  const [{ items: shelved }, { items: clips }, placed, files, hidden] = await Promise.all([
    getShelf(),
    getClippings(undefined, { trashed }),
    getShelving(),
    listFiles(),
    trashed ? Promise.resolve(new Set<string>()) : trashedIds(),
  ]);
  const items = shelved.filter((item) => !hidden.has(item.id));
  const fileOf = new Map<string, LibraryBook>();
  for (const file of files) {
    const owner = file.paperId ?? file.clipId ?? shelfItemFor(file, items);
    if (owner && !fileOf.has(owner)) fileOf.set(owner, file);
  }
  const minutesIn = (file?: LibraryBook) => (file?.totalChars ? Math.max(1, Math.round(file.totalChars / CHARS_PER_MINUTE)) : undefined);

  const books: ShelfBook[] = [
    ...items.map((item): ShelfBook => {
      const s = placed.get(item.id);
      const file = fileOf.get(item.id);
      return {
        id: item.id,
        kind: "book",
        title: item.title.replace(/\s*[:(].*$/, "") || item.title,
        author: item.author,
        year: item.year,
        url: item.goodreadsId ? `https://www.goodreads.com/book/show/${item.goodreadsId}` : undefined,
        topic: s?.topic ?? "unsorted",
        minutes: minutesIn(file) ?? Math.round((item.pages && item.pages >= 30 ? item.pages : 300) * 1.4),
        dek: clean(item.review, 320) || clean(item.description, 320) || undefined,
        tags: s?.tags ?? [],
        favorite: s?.favorite ?? item.rating === 5,
        pct: item.status === "read" ? 1 : item.status === "reading" ? 0.3 : 0,
        measured: false,
        highlights: 0,
        added: Date.parse(item.dateAdded ?? item.dateRead ?? "") || 0,
        photo: item.cover,
        color: item.color,
        rating: item.rating,
        agent: false,
        fileId: file?.id,
        readable: false,
      };
    }),
    ...clips.map((clip): ShelfBook => {
      const s = placed.get(clip.id);
      const file = fileOf.get(clip.id);
      const text = clean(clip.tweet?.text, 2000);
      const year = clip.paper?.year ?? (Number(clip.published?.slice(0, 4)) || undefined);
      const image = clip.image ?? clip.tweet?.media[0];
      return {
        id: clip.id,
        kind: clip.kind,
        title: clip.title ?? (text.split(/(?<=[.!?])\s/)[0].slice(0, 90) || `A post by @${clip.tweet?.handle}`),
        author: clip.paper?.authors.length
          ? clip.paper.authors.length > 2
            ? `${clip.paper.authors[0]} et al.`
            : clip.paper.authors.join(" & ")
          : (clip.author ?? (clip.tweet ? `@${clip.tweet.handle}` : clip.source)),
        year,
        url: clip.url,
        topic: s?.topic ?? "unsorted",
        minutes:
          minutesIn(file) ??
          (clip.kind === "tweet" ? Math.max(1, Math.round(text.split(/\s+/).length / 230)) : (clip.minutes ?? (clip.kind === "paper" ? 35 : 8))),
        dek: clean(clip.paper?.pwc?.tldr ?? clip.excerpt ?? clip.enriched?.summary ?? (clip.tweet && clip.title ? text : undefined), 320) || undefined,
        tags: s?.tags ?? [],
        favorite: s?.favorite ?? false,
        pct: 0,
        measured: false,
        highlights: 0,
        added: Date.parse(clip.saved) || 0,
        image: image && !/\/blank\.(jpe?g|png|gif)\b/i.test(image) ? image : undefined,
        agent: Boolean(clip.via),
        fileId: file?.id,
        readable: clip.kind === "paper" ? Boolean(clip.paper?.pdf) : readableClip(clip),
      };
    }),
  ];
  return { books, unsorted: books.filter((b) => !placed.has(b.id)).length };
}
