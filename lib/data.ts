import "server-only";
import { batched, db, records } from "./db";
import type { Clip, ClipKind, ClippingsData, Item, ShelfData } from "./types";

// ---- shelf -------------------------------------------------------------------------------------

export async function getShelf(): Promise<ShelfData> {
  const database = await db();
  const [books, stamp] = await database.batch([
    database.prepare("SELECT data FROM books ORDER BY position"),
    database.prepare("SELECT value FROM meta WHERE key = 'shelf_updated_at'"),
  ]);
  return {
    items: records<Item>(books.results as { data: string }[]),
    updatedAt: (stamp.results[0] as { value?: string } | undefined)?.value ?? new Date(0).toISOString(),
  };
}

export async function getBookCount(): Promise<number> {
  return (await (await db()).prepare("SELECT COUNT(*) AS n FROM books").first<{ n: number }>())?.n ?? 0;
}

export type StoredBook = { item: Item; lookedUp: boolean };

/** Every stored book, in shelf order, with whether Open Library has been asked about it. */
export async function getStoredBooks(): Promise<StoredBook[]> {
  const { results } = await (await db())
    .prepare("SELECT data, looked_up FROM books ORDER BY position")
    .all<{ data: string; looked_up: number }>();
  return results.map((row) => ({ item: JSON.parse(row.data) as Item, lookedUp: row.looked_up === 1 }));
}

/** Replaces the shelf with `books`, in this order, and stamps when it changed. */
export async function replaceShelf(books: StoredBook[], updatedAt: string) {
  const database = await db();
  const keep = books.map((b) => b.item.id);
  await batched(database, [
    ...books.map(({ item, lookedUp }, position) =>
      database
        .prepare(
          `INSERT INTO books (id, position, looked_up, data) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT (id) DO UPDATE SET position = ?2, looked_up = ?3, data = ?4`,
        )
        .bind(item.id, position, lookedUp ? 1 : 0, JSON.stringify(item)),
    ),
    // Books no longer on any Goodreads shelf leave this one too.
    database
      .prepare(`DELETE FROM books WHERE id NOT IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify(keep)),
    database
      .prepare("INSERT INTO meta (key, value) VALUES ('shelf_updated_at', ?1) ON CONFLICT (key) DO UPDATE SET value = ?1")
      .bind(updatedAt),
  ]);
}

// ---- clippings ---------------------------------------------------------------------------------

/** Leaves out what the owner has put in the Trash, and what they only opened from their Feed (lib/triage.ts). */
const NOT_TRASHED = "id NOT IN (SELECT id FROM triage WHERE trashed_at IS NOT NULL OR place = 'feed')";

/** Newest first, or only one kind; what's in the Trash (or only in the Feed) only when asked for. */
export async function getClippings(kind?: ClipKind, { trashed = false } = {}): Promise<ClippingsData> {
  const database = await db();
  const where = [kind ? "kind = ?1" : "", trashed ? "" : NOT_TRASHED].filter(Boolean).join(" AND ");
  const sql = `SELECT data FROM clippings ${where ? `WHERE ${where}` : ""} ORDER BY saved DESC, added_at DESC`;
  const query = kind ? database.prepare(sql).bind(kind) : database.prepare(sql);
  return { items: records<Clip>((await query.all<{ data: string }>()).results) };
}

/** The newest `limit` clippings of one kind, and how many there are in all. */
export async function getClippingsPage(kind: ClipKind, limit: number): Promise<ClippingsData & { total: number }> {
  const database = await db();
  const [rows, count] = await database.batch([
    database.prepare(`SELECT data FROM clippings WHERE kind = ?1 AND ${NOT_TRASHED} ORDER BY saved DESC, added_at DESC LIMIT ?2`).bind(kind, limit),
    database.prepare(`SELECT COUNT(*) AS total FROM clippings WHERE kind = ?1 AND ${NOT_TRASHED}`).bind(kind),
  ]);
  return { items: records<Clip>(rows.results as { data: string }[]), total: Number((count.results[0] as { total: number }).total) };
}

/** The kinds that have at least one clipping, which decides which sections exist. */
export async function getClipKinds(): Promise<ClipKind[]> {
  const { results } = await (await db()).prepare(`SELECT DISTINCT kind FROM clippings WHERE ${NOT_TRASHED}`).all<{ kind: ClipKind }>();
  return results.map((row) => row.kind);
}

export async function getClipping(id: string): Promise<Clip | null> {
  const row = await (await db()).prepare("SELECT data FROM clippings WHERE id = ?1").bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as Clip) : null;
}

export async function saveClipping(clip: Clip) {
  await (await db())
    .prepare(
      `INSERT INTO clippings (id, kind, saved, added_at, data) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (id) DO UPDATE SET kind = ?2, saved = ?3, data = ?5`,
    )
    .bind(clip.id, clip.kind, clip.saved, new Date().toISOString(), JSON.stringify(clip))
    .run();
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await (await db()).prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string | null) {
  const database = await db();
  await (value === null
    ? database.prepare("DELETE FROM meta WHERE key = ?1").bind(key)
    : database.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = ?2").bind(key, value)
  ).run();
}

export async function deleteClipping(id: string): Promise<boolean> {
  const { meta } = await (await db()).prepare("DELETE FROM clippings WHERE id = ?1").bind(id).run();
  return meta.changes > 0;
}
