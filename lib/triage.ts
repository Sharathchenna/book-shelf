import "server-only";
import { getClipping, deleteClipping } from "./data";
import { batched, db } from "./db";
import { audioKeys, getFile, keys, listFiles, removeFile } from "./library";
import { removeDocs } from "./search/vectors";
import { removeShelving } from "./shelving";
import { getStorage } from "./storage";

/**
 * Where each book and clipping stands in the owner's reading, as Readwise Reader keeps it: new
 * things wait in the Inbox, some are saved for Later, and what's done with goes to the Archive.
 * Things can be put in the Trash (and taken out again) before they're deleted for good.
 */

/** "feed": opened from the Feed (lib/feeds.ts) and not saved to the library. */
export const PLACES = ["inbox", "later", "archive", "feed"] as const;
export type Place = (typeof PLACES)[number];
export const isPlace = (v: unknown): v is Place => typeof v === "string" && (PLACES as readonly string[]).includes(v);

export type Triage = { place: Place; seen: boolean; trashed?: string };

type Row = { id: string; place: string; seen: number; trashed_at: string | null };

export async function getTriage(): Promise<Map<string, Triage>> {
  const { results } = await (await db()).prepare("SELECT id, place, seen, trashed_at FROM triage").all<Row>();
  return new Map(results.map((row) => [row.id, { place: isPlace(row.place) ? row.place : "inbox", seen: row.seen === 1, ...(row.trashed_at ? { trashed: row.trashed_at } : {}) }]));
}

/**
 * Where a thing with no row stands: a Goodreads book in the Archive once read and saved for Later
 * otherwise (the shelf is a record of reading, not a pile to sort); anything saved to read in the
 * Inbox until it's finished. Something already started has been seen.
 */
export function defaultTriage(book: { id: string; kind: string; pct: number; fileId?: string }): Triage {
  const goodreads = book.kind === "book" && book.fileId !== book.id;
  if (book.pct >= 1) return { place: "archive", seen: true };
  if (goodreads) return { place: "later", seen: true };
  return { place: "inbox", seen: book.pct > 0 };
}

/** Moves things, marks them seen or unseen, or puts them in (or takes them out of) the Trash. */
export async function setTriage(items: { id: string; current: Triage }[], patch: { place?: Place; seen?: boolean; trashed?: boolean }) {
  const now = new Date().toISOString();
  const database = await db();
  await batched(
    database,
    items.map(({ id, current }) => {
      const trashed = patch.trashed === undefined ? (current.trashed ?? null) : patch.trashed ? (current.trashed ?? now) : null;
      return database
        .prepare(
          `INSERT INTO triage (id, place, seen, trashed_at, at) VALUES (?1, ?2, ?3, ?4, ?5)
           ON CONFLICT (id) DO UPDATE SET place = ?2, seen = ?3, trashed_at = ?4, at = ?5`,
        )
        .bind(id, patch.place ?? current.place, (patch.seen ?? current.seen) ? 1 : 0, trashed, now);
    }),
  );
}

/**
 * Deletes for good: a clipping with the ebook made of it, or a file of its own, with their
 * highlights, places, narration and search entries. A Goodreads book can't go (the next sync
 * would bring it back), so it's only ever hidden. Returns the ids deleted.
 */
export async function purge(ids: string[]): Promise<string[]> {
  const files = await listFiles();
  const gone: string[] = [];
  for (const id of ids) {
    const clip = await getClipping(id);
    const own = files.filter((file) => file.id === id || (clip && (file.clipId === id || file.paperId === id)));
    if (!clip && own.length === 0) continue;
    for (const file of own) await removeBook(file.id);
    if (clip) {
      await deleteClipping(id);
      // What's kept beside it: a video's or episode's transcript, a feed item's post (lib/media.ts, lib/feeds.ts).
      await Promise.all([`media/${id}.json`, `feed/${id}.html`].map((key) => getStorage().delete(key).catch(() => {})));
      await removeShelving(id).catch(() => {});
      await removeDocs([`clip:${id}`]).catch((error) => console.error("Removing from the search index failed", id, error));
    }
    gone.push(id);
  }
  if (gone.length) {
    const database = await db();
    await batched(database, gone.flatMap((id) => [database.prepare("DELETE FROM triage WHERE id = ?1").bind(id), database.prepare("DELETE FROM feed_items WHERE clip_id = ?1").bind(id)]));
  }
  return gone;
}

/** A file and everything kept of it in storage (as DELETE /api/books/[id] does). */
export async function removeBook(id: string) {
  const book = await getFile(id);
  if (!book) return;
  const narration = await audioKeys(id);
  await removeFile(id);
  const storage = getStorage();
  await Promise.all(
    [keys.file(book), keys.text(id), keys.brief(id), book.coverKey, ...narration].filter((key): key is string => Boolean(key)).map((key) => storage.delete(key)),
  );
}

/** How long a thing stays in the Trash before the nightly sync deletes it. */
export const TRASH_DAYS = 30;

/** Deletes what's been in the Trash longer than TRASH_DAYS; called by the nightly sync. */
export async function emptyOldTrash(): Promise<number> {
  const before = new Date(Date.now() - TRASH_DAYS * 86_400_000).toISOString();
  const { results } = await (await db()).prepare("SELECT id FROM triage WHERE trashed_at IS NOT NULL AND trashed_at < ?1").bind(before).all<{ id: string }>();
  return (await purge(results.map((r) => r.id))).length;
}
