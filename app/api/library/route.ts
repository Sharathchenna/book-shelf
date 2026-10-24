import { requireOwner } from "@/lib/auth/session";
import { lookOf, TOPICS, type ShelfBook } from "@/lib/bookcase";
import { getClippings, getShelf } from "@/lib/data";
import { allProgress, highlightCounts, listFiles, shelfItemFor } from "@/lib/library";
import { ARTICLE_EPUB_BUILD } from "@/lib/library-types";
import { shelfBooks } from "@/lib/shelving";
import { shelfConfig } from "@/shelf.config";

/**
 * The whole library as data, for the Android app: every book and clipping as the bookcase draws
 * it (with each spine's look, so it's drawn the same), with the owner's reading laid over it as
 * the home page does from /api/me; the Goodreads books and the clippings behind the cards; and
 * the reader's files with where the owner is in each. Answered with an ETag, so a device that
 * already has this version gets a 304.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const [{ books }, { items, updatedAt }, { items: clips }, files, progress, marks] = await Promise.all([
    shelfBooks(),
    getShelf(),
    getClippings(),
    listFiles(),
    allProgress(),
    highlightCounts(),
  ]);

  const fileOf = new Map<string, string>();
  for (const file of files) {
    // An article's copy from an older conversion is made again when next opened (/api/books/clips),
    // its highlights carried over, so the app goes to the opener rather than to it.
    if (file.clipId && (file.build ?? 1) < ARTICLE_EPUB_BUILD) continue;
    const of = file.paperId ?? file.clipId ?? shelfItemFor(file, items);
    if (of && !fileOf.has(of)) fileOf.set(of, file.id);
  }
  const shelf = books.map((b) => {
    const fileId = fileOf.get(b.id) ?? b.fileId;
    const fraction = fileId ? (progress.get(fileId)?.fraction ?? 0) : 0;
    // The owner's own place in a book wins over its Goodreads shelf, unless that says it's read.
    const measured = Boolean(fileId && fraction > 0 && b.pct < 1);
    const book = {
      ...b,
      fileId,
      pct: measured ? Math.min(fraction, 0.99) : b.pct,
      measured: measured || b.measured,
      highlights: fileId ? (marks.get(fileId) ?? 0) : 0,
    };
    return { ...book, look: lookOf(book) };
  });

  // Files on no shelf (an EPUB or PDF added that matches no Goodreads book) have no spine on the
  // site's bookcase; the app shows them as books of their own.
  const loose = files
    .filter((file) => !(file.paperId ?? file.clipId ?? shelfItemFor(file, items)))
    .map((file) => {
      const fraction = progress.get(file.id)?.fraction ?? 0;
      const book: ShelfBook = {
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
      };
      return { ...book, look: lookOf(book) };
    });

  const body = JSON.stringify({
    owner: shelfConfig.owner,
    updatedAt,
    topics: TOPICS.map(({ key, name, shades, blurb }) => ({ key, name, shades, blurb })),
    books: [...shelf, ...loose],
    items,
    clips,
    files: files.map((file) => ({ ...file, shelfItemId: shelfItemFor(file, items), progress: progress.get(file.id) })),
  });
  const etag = `"${await digest(body)}"`;
  const headers = { etag, "cache-control": "private, no-cache", "content-type": "application/json" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
