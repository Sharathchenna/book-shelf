import "server-only";
import { db, records } from "./db";
import type { AudioLine, AudioSection, Highlight, LibraryBook, Progress } from "./library-types";
import type { Review } from "./review";
import type { Item } from "./types";

/** Where each book's bytes live in storage (R2). Everything else about it is in D1. */
export const keys = {
  file: (book: Pick<LibraryBook, "id" | "format">) => `books/${book.id}.${book.format ?? "epub"}`,
  text: (id: string) => `text/${id}.json`,
  brief: (id: string) => `brief/${id}.json`,
  cover: (id: string, ext: string) => `covers/${id}.${ext}`,
  audio: (id: string, voice: string, section: number) => `audio/${id}/${voice}/${section}.mp3`,
};

export const CONTENT_TYPES = { epub: "application/epub+zip", pdf: "application/pdf" } as const;

/** Book ids are generated server-side; anything else is rejected before touching storage. */
export const validId = (id: string) => /^[a-z0-9]{8,32}$/.test(id);

// ---- the files ---------------------------------------------------------------------------------

export async function listFiles(): Promise<LibraryBook[]> {
  const { results } = await (await db()).prepare("SELECT data FROM files ORDER BY added_at").all<{ data: string }>();
  return records<LibraryBook>(results);
}

export async function getFile(id: string): Promise<LibraryBook | null> {
  if (!validId(id)) return null;
  const row = await (await db()).prepare("SELECT data FROM files WHERE id = ?1").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as LibraryBook) : null;
}

export async function putFile(book: LibraryBook) {
  await (await db())
    .prepare("INSERT INTO files (id, added_at, data) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET data = ?3")
    .bind(book.id, book.addedAt, JSON.stringify(book))
    .run();
}

/** Forgets a file, the owner's place and notes in it (and their place in the review), and its narration (and its directions). The caller deletes the bytes. */
export async function removeFile(id: string) {
  const database = await db();
  await database.batch(
    ["files", "progress", "notes", "audio", "directions", "reviews"].map((table) =>
      database.prepare(`DELETE FROM ${table} WHERE ${table === "files" ? "id" : "file_id"} = ?1`).bind(id),
    ),
  );
}

/**
 * A copy made again (an article rebuilt by a newer conversion) taking over from the one before:
 * its highlights, their places in the review, and the owner's place. The highlights' CFIs were
 * made against the old copy's markup, so they're dropped (a PDF page's are kept) and each is
 * found again by its text and the quote either side, as both readers already do.
 */
export async function adoptFile(toId: string, fromId: string) {
  const now = new Date().toISOString();
  const notes = await getNotes(fromId);
  if (notes.length) await mergeNotes(toId, notes.map((n) => ({ ...n, cfi: n.cfi.startsWith("page:") ? n.cfi : "", updatedAt: now })));
  await (await db()).prepare("UPDATE reviews SET file_id = ?1 WHERE file_id = ?2").bind(toId, fromId).run();
  const place = await getProgress(fromId);
  if (place && !(await getProgress(toId))) await putProgress(toId, { ...place, cfi: place.cfi.startsWith("page:") ? place.cfi : "" });
}

// ---- the owner's place and notes ---------------------------------------------------------------

export async function getProgress(id: string): Promise<Progress | null> {
  const row = await (await db()).prepare("SELECT data FROM progress WHERE file_id = ?1").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Progress) : null;
}

/** Every file's progress, keyed by file id. */
export async function allProgress(): Promise<Map<string, Progress>> {
  const { results } = await (await db()).prepare("SELECT file_id, data FROM progress").all<{ file_id: string; data: string }>();
  return new Map(results.map((row) => [row.file_id, JSON.parse(row.data) as Progress]));
}

export async function putProgress(id: string, progress: Progress) {
  await upsert("progress", id, progress);
}

const live = (notes: Highlight[]) => notes.filter((n) => !n.deleted);

/** A book's highlights and notes; with `removed`, also the markers left by removed ones (for syncing devices). */
export async function getNotes(id: string, { removed = false } = {}): Promise<Highlight[]> {
  const row = await (await db()).prepare("SELECT data FROM notes WHERE file_id = ?1").bind(id).first<{ data: string }>();
  const notes = row ? (JSON.parse(row.data) as Highlight[]) : [];
  return removed ? notes : live(notes);
}

/** How many highlights each file holds, keyed by file id. */
export async function highlightCounts(): Promise<Map<string, number>> {
  const { results } = await (await db())
    .prepare("SELECT file_id, (SELECT count(*) FROM json_each(notes.data) WHERE json_extract(value, '$.deleted') IS NULL) AS n FROM notes")
    .all<{ file_id: string; n: number }>();
  return new Map(results.map((row) => [row.file_id, row.n]));
}

/** Every file's highlights, for the daily review and the Markdown export. */
export async function allNotes(): Promise<Map<string, Highlight[]>> {
  const { results } = await (await db()).prepare("SELECT file_id, data FROM notes").all<{ file_id: string; data: string }>();
  return new Map(results.map((row) => [row.file_id, live(JSON.parse(row.data) as Highlight[])]));
}

/** Where each highlight stands in the daily review (lib/review.ts), keyed by highlight id. */
export async function allReviews(): Promise<Map<string, Review>> {
  const { results } = await (await db())
    .prepare("SELECT highlight_id, step, due, last, off FROM reviews")
    .all<{ highlight_id: string; step: number; due: number; last: number; off: number }>();
  return new Map(results.map((r) => [r.highlight_id, { step: r.step, due: r.due, last: r.last, ...(r.off ? { off: true } : {}) }]));
}

export async function putReview(highlightId: string, fileId: string, review: Review) {
  await (await db())
    .prepare(
      `INSERT INTO reviews (highlight_id, file_id, step, due, last, off) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (highlight_id) DO UPDATE SET step = ?3, due = ?4, last = ?5, off = ?6`,
    )
    .bind(highlightId, fileId, review.step, review.due, review.last, review.off ? 1 : 0)
    .run();
}

/** How long a removed highlight's marker is kept: longer than any device stays offline. */
const REMOVED_KEEP_MS = 90 * 86_400_000;
const changedAt = (n: Highlight) => n.updatedAt ?? n.createdAt;

/**
 * Applies changes to a book's highlights, from the web reader or a device: each one by its id,
 * the newer copy winning, so two devices editing the same book offline don't undo each other.
 * Returns the book's highlights afterwards (removed ones included).
 */
export async function mergeNotes(id: string, changes: Highlight[]): Promise<Highlight[]> {
  const byId = new Map((await getNotes(id, { removed: true })).map((n) => [n.id, n]));
  for (const change of changes) {
    const kept = byId.get(change.id);
    if (!kept || changedAt(change) >= changedAt(kept)) byId.set(change.id, change);
  }
  const now = Date.now();
  const notes = [...byId.values()].filter((n) => !n.deleted || now - Date.parse(changedAt(n)) < REMOVED_KEEP_MS);
  await upsert("notes", id, notes);
  return notes;
}

export async function putNotes(id: string, notes: Highlight[]) {
  await upsert("notes", id, notes);
}

async function upsert(table: "progress" | "notes", id: string, value: unknown) {
  await (await db())
    .prepare(`INSERT INTO ${table} (file_id, data) VALUES (?1, ?2) ON CONFLICT (file_id) DO UPDATE SET data = ?2`)
    .bind(id, JSON.stringify(value))
    .run();
}

// ---- narration ---------------------------------------------------------------------------------

/** Voice ids (af_heart, fi_adrian; lib/voices.ts): checked before they go into a storage key. */
export const validVoice = (voice: string) => /^[a-z]{2}_[a-z]{2,16}$/.test(voice);

/** The chapters read aloud in one voice, without their sentences. */
export async function listAudio(id: string, voice: string): Promise<{ section: number; duration: number }[]> {
  const { results } = await (await db())
    .prepare("SELECT section, duration FROM audio WHERE file_id = ?1 AND voice = ?2 ORDER BY section")
    .bind(id, voice)
    .all<{ section: number; duration: number }>();
  return results;
}

/** Stored directions for a run of a section's sentences (lib/directions.ts), if they were made for the same sentences. */
export async function getDirections(id: string, section: number, chunk: number, hash: string): Promise<unknown[] | null> {
  const row = await (await db())
    .prepare("SELECT data FROM directions WHERE file_id = ?1 AND section = ?2 AND chunk = ?3 AND hash = ?4")
    .bind(id, section, chunk, hash)
    .first<{ data: string }>();
  return row ? (JSON.parse(row.data) as unknown[]) : null;
}

export async function putDirections(id: string, section: number, chunk: number, hash: string, data: unknown[]) {
  await (await db())
    .prepare(
      `INSERT INTO directions (file_id, section, chunk, hash, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (file_id, section, chunk) DO UPDATE SET hash = ?4, data = ?5, created_at = ?6`,
    )
    .bind(id, section, chunk, hash, JSON.stringify(data), new Date().toISOString())
    .run();
}

/** The voices a book has chapters saved in, and how many in each. */
export async function audioVoices(id: string): Promise<{ voice: string; sections: number }[]> {
  const { results } = await (await db())
    .prepare("SELECT voice, COUNT(*) AS sections FROM audio WHERE file_id = ?1 GROUP BY voice ORDER BY sections DESC")
    .bind(id)
    .all<{ voice: string; sections: number }>();
  return results;
}

export async function getAudio(id: string, voice: string, section: number): Promise<AudioSection | null> {
  const row = await (await db())
    .prepare("SELECT duration, data FROM audio WHERE file_id = ?1 AND voice = ?2 AND section = ?3")
    .bind(id, voice, section)
    .first<{ duration: number; data: string }>();
  return row ? { section, voice, duration: row.duration, lines: JSON.parse(row.data) as AudioLine[] } : null;
}

export async function putAudio(id: string, audio: AudioSection, bytes: number) {
  await (await db())
    .prepare(
      `INSERT INTO audio (file_id, voice, section, duration, bytes, created_at, data) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT (file_id, voice, section) DO UPDATE SET duration = ?4, bytes = ?5, created_at = ?6, data = ?7`,
    )
    .bind(id, audio.voice, audio.section, audio.duration, bytes, new Date().toISOString(), JSON.stringify(audio.lines))
    .run();
}

/** Every stored narration of a file, for deleting it with the file. */
export async function audioKeys(id: string): Promise<string[]> {
  const { results } = await (await db())
    .prepare("SELECT voice, section FROM audio WHERE file_id = ?1")
    .bind(id)
    .all<{ voice: string; section: number }>();
  return results.map((row) => keys.audio(id, row.voice, row.section));
}

// ---- matching files to shelf books -------------------------------------------------------------

const normalize = (s: string) =>
  s
    .toLowerCase()
    .split(/[:(]/)[0]
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The shelf book a file belongs to: the one it was added from, or else one with the same title
 * and author. Matched when read, not only at upload, so a file added before its book was on
 * Goodreads finds it after the next sync.
 */
export function shelfItemFor(
  book: Pick<LibraryBook, "shelfItemId" | "paperId" | "clipId" | "title" | "author">,
  items: Item[],
): string | undefined {
  if (book.shelfItemId && items.some((i) => i.id === book.shelfItemId)) return book.shelfItemId;
  return book.paperId || book.clipId ? undefined : matchShelfItem(book.title, book.author, items);
}

/** The shelf item an uploaded book belongs to: same title (before any subtitle) and author surname. */
export function matchShelfItem(title: string, author: string, items: Item[]): string | undefined {
  const t = normalize(title);
  const surname = normalize(author).split(" ").at(-1) ?? "";
  return items.find((item) => {
    const itemTitle = normalize(item.title);
    const sameTitle = itemTitle === t || itemTitle.startsWith(`${t} `) || t.startsWith(`${itemTitle} `);
    return sameTitle && normalize(item.author).includes(surname);
  })?.id;
}
