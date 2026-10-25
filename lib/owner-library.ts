import "server-only";
import { lookOf, type ShelfBook } from "./bookcase";
import { getClippings, getShelf } from "./data";
import { allProgress, highlightCounts, listFiles, shelfItemFor } from "./library";
import { ARTICLE_EPUB_BUILD } from "./library-types";
import { shelfBooks } from "./shelving";
import { defaultTriage, getTriage, type Place } from "./triage";

/** A book or clipping as the owner has it: the bookcase's, with their reading and their sorting laid over it. */
export type OwnerBook = ShelfBook & {
  look: ReturnType<typeof lookOf>;
  /** Inbox, Later or Archive (lib/triage.ts). */
  place: Place;
  /** Opened at least once; an unseen thing wears a dot. */
  seen: boolean;
  /** ISO time it was put in the Trash. */
  trashed?: string;
};

/**
 * Every book and clipping with the owner's reading laid over it, as the home page does from
 * /api/me, and where each stands in their sorting; with the Goodreads books, the clippings and the
 * reader's files behind them. For the Android app (/api/library) and the routes that change it.
 */
export async function ownerLibrary() {
  const [{ books }, { items, updatedAt }, { items: clips }, files, progress, marks, triage] = await Promise.all([
    shelfBooks({ trashed: true }),
    getShelf(),
    getClippings(undefined, { trashed: true }),
    listFiles(),
    allProgress(),
    highlightCounts(),
    getTriage(),
  ]);

  // An article's copy from an older conversion is made again when next opened (/api/books/clips),
  // its highlights carried over, so the app goes to the opener rather than to it.
  const stale = new Set(files.filter((file) => file.clipId && (file.build ?? 1) < ARTICLE_EPUB_BUILD).map((file) => file.id));
  const fileOf = new Map<string, string>();
  for (const file of files) {
    if (stale.has(file.id)) continue;
    const of = file.paperId ?? file.clipId ?? shelfItemFor(file, items);
    if (of && !fileOf.has(of)) fileOf.set(of, file.id);
  }
  const sorted = (book: ShelfBook): OwnerBook => ({ ...book, look: lookOf(book), ...(triage.get(book.id) ?? defaultTriage(book)) });

  const shelf = books.map((b) => {
    const fileId = fileOf.get(b.id) ?? (b.fileId && !stale.has(b.fileId) ? b.fileId : undefined);
    const fraction = fileId ? (progress.get(fileId)?.fraction ?? 0) : 0;
    // The owner's own place in a book wins over its Goodreads shelf, unless that says it's read.
    const measured = Boolean(fileId && fraction > 0 && b.pct < 1);
    return sorted({
      ...b,
      fileId,
      pct: measured ? Math.min(fraction, 0.99) : b.pct,
      measured: measured || b.measured,
      highlights: fileId ? (marks.get(fileId) ?? 0) : 0,
    });
  });

  // Files on no shelf (an EPUB or PDF added that matches no Goodreads book) have no spine on the
  // site's bookcase; the app shows them as books of their own.
  const loose = files
    .filter((file) => !(file.paperId ?? file.clipId ?? shelfItemFor(file, items)))
    .map((file) => {
      const fraction = progress.get(file.id)?.fraction ?? 0;
      return sorted({
        id: file.id,
        kind: "book",
        title: file.title,
        author: file.author,
        topic: "unsorted",
        minutes: Math.max(1, Math.round(file.totalChars / 1150)),
        tags: [],
        favorite: false,
        pct: Math.min(fraction, 0.99),
        measured: fraction > 0,
        highlights: marks.get(file.id) ?? 0,
        added: Date.parse(file.addedAt) || 0,
        agent: false,
        fileId: file.id,
        readable: true,
      });
    });

  return { updatedAt, books: [...shelf, ...loose], items, clips, files, progress };
}
