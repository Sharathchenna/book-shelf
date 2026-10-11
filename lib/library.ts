import "server-only";
import { db, records } from "./db";
import type { Highlight, LibraryBook, Progress } from "./library-types";
import type { Item } from "./types";

/** Where each book's bytes live in storage (R2). Everything else about it is in D1. */
export const keys = {
  file: (book: Pick<LibraryBook, "id" | "format">) => `books/${book.id}.${book.format ?? "epub"}`,
  text: (id: string) => `text/${id}.json`,
  cover: (id: string, ext: string) => `covers/${id}.${ext}`,
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

/** Forgets a file and the owner's place and notes in it. The caller deletes the bytes. */
export async function removeFile(id: string) {
  const database = await db();
  await database.batch(
    ["files", "progress", "notes"].map((table) =>
      database.prepare(`DELETE FROM ${table} WHERE ${table === "files" ? "id" : "file_id"} = ?1`).bind(id),
    ),
  );
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

export async function getNotes(id: string): Promise<Highlight[]> {
  const row = await (await db()).prepare("SELECT data FROM notes WHERE file_id = ?1").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Highlight[]) : [];
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
  book: Pick<LibraryBook, "shelfItemId" | "paperId" | "title" | "author">,
  items: Item[],
): string | undefined {
  if (book.shelfItemId && items.some((i) => i.id === book.shelfItemId)) return book.shelfItemId;
  return book.paperId ? undefined : matchShelfItem(book.title, book.author, items);
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
