import { requireOwner } from "@/lib/auth/session";
import { getClipping, getShelf } from "@/lib/data";
import { parseEpub } from "@/lib/epub/parse";
import { keys, matchShelfItem, putFile, validId } from "@/lib/library";
import type { Item } from "@/lib/types";
import type { LibraryBook } from "@/lib/library-types";
import { getStorage, MAX_BOOK_BYTES, putJson } from "@/lib/storage";

const MAX_PAGES = 5000;
const MAX_TEXT_CHARS = 20_000_000;
const MAX_COVER_BYTES = 2 * 1024 * 1024;

/**
 * After the browser has uploaded the file: add it to the library index with its cover and text,
 * matched to a shelf book. EPUBs are read here. PDFs are read in the browser (pdf.js is already
 * loaded there, and parsing large PDFs would strain a Worker), which sends the per-page text,
 * outline titles and a rendered first page.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[id]/finalize">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { items } = await getShelf();
  // Added from a book's card: it belongs to that book, whatever the file's own metadata says.
  const shelfItemId = items.some((i) => i.id === body.shelfItemId) ? (body.shelfItemId as string) : undefined;
  return body.format === "pdf" ? finalizePdf(id, body, shelfItemId, items) : finalizeEpub(id, body, shelfItemId, items);
}

async function finalizeEpub(id: string, body: Record<string, unknown>, shelfItemId: string | undefined, items: Item[]) {
  const storage = getStorage();
  const key = keys.file({ id, format: "epub" });
  const bytes = await storage.getBytes(key);
  if (!bytes) return Response.json({ error: "The upload didn't arrive. Try again." }, { status: 404 });
  if (bytes.byteLength > MAX_BOOK_BYTES) {
    await storage.delete(key);
    return Response.json({ error: "Files up to 100 MB only." }, { status: 413 });
  }

  let parsed;
  try {
    parsed = await parseEpub(bytes);
  } catch (error) {
    await storage.delete(key);
    return Response.json({ error: (error as Error).message || "That file couldn't be read as an EPUB." }, { status: 422 });
  }

  let coverKey: string | undefined;
  if (parsed.cover) {
    coverKey = keys.cover(id, parsed.cover.ext);
    await storage.put(coverKey, parsed.cover.bytes, parsed.cover.type);
  }
  await putJson(keys.text(id), parsed.sections.map((s) => s.text));

  // An arXiv paper converted to an EPUB in the browser (see arxiv-epub.ts).
  const clip = typeof body.paperId === "string" ? await getClipping(body.paperId) : null;
  const paper = clip?.kind === "paper" ? clip : undefined;

  return addToIndex({
    id,
    format: "epub",
    title: paper?.title ?? parsed.title,
    author: paper?.paper?.authors.length ? authorLine(paper.paper.authors) : parsed.author,
    paperId: paper?.id,
    shelfItemId: paper ? undefined : (shelfItemId ?? matchShelfItem(parsed.title, parsed.author, items)),
    coverKey,
    sections: parsed.sections.map((s) => ({ title: s.title, chars: s.text.length })),
    totalChars: parsed.sections.reduce((sum, s) => sum + s.text.length, 0),
    bytes: bytes.byteLength,
    addedAt: new Date().toISOString(),
  });
}

async function finalizePdf(id: string, body: Record<string, unknown>, shelfItemId: string | undefined, items: Item[]) {
  const storage = getStorage();
  const key = keys.file({ id, format: "pdf" });
  const bytes = await storage.size(key);
  if (bytes === null) return Response.json({ error: "The upload didn't arrive. Try again." }, { status: 404 });
  if (bytes > MAX_BOOK_BYTES) {
    await storage.delete(key);
    return Response.json({ error: "Files up to 100 MB only." }, { status: 413 });
  }

  const pages = body.pages;
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > MAX_PAGES ||
    !pages.every((p) => p && typeof p.text === "string" && (p.title === undefined || typeof p.title === "string"))
  ) {
    return Response.json({ error: "The PDF's pages didn't come through." }, { status: 400 });
  }
  const sections = (pages as { title?: string; text: string }[]).map((p, i) => ({
    title: p.title?.trim().slice(0, 200) || `Page ${i + 1}`,
    text: p.text,
  }));
  const totalChars = sections.reduce((sum, s) => sum + s.text.length, 0);
  if (totalChars > MAX_TEXT_CHARS) return Response.json({ error: "That PDF has too much text." }, { status: 413 });

  // A clipped paper or the shelf book it was added to names it; otherwise take what the browser
  // read from the PDF or its file name.
  const clip = typeof body.paperId === "string" ? await getClipping(body.paperId) : null;
  const paper = clip?.kind === "paper" ? clip : undefined;
  const book = items.find((i) => i.id === shelfItemId);
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback);
  const title = paper?.title ?? book?.title ?? text(body.title, "Untitled PDF");
  const author = paper?.paper?.authors.length ? authorLine(paper.paper.authors) : (book?.author ?? text(body.author, ""));

  let coverKey: string | undefined;
  if (typeof body.cover === "string" && body.cover.length < (MAX_COVER_BYTES * 4) / 3) {
    const cover = Uint8Array.from(atob(body.cover), (c) => c.charCodeAt(0));
    // JPEG only: the browser renders the first page to one.
    if (cover[0] === 0xff && cover[1] === 0xd8) {
      coverKey = keys.cover(id, "jpg");
      await storage.put(coverKey, cover, "image/jpeg");
    }
  }
  await putJson(keys.text(id), sections.map((s) => s.text));

  return addToIndex({
    id,
    format: "pdf",
    title,
    author,
    paperId: paper?.id,
    shelfItemId: paper ? undefined : (shelfItemId ?? matchShelfItem(title, author, items)),
    coverKey,
    sections: sections.map((s) => ({ title: s.title, chars: s.text.length })),
    totalChars,
    bytes,
    addedAt: new Date().toISOString(),
  });
}

/** "Vaswani, Shazeer and Parmar", or "Vaswani et al." when there are more. */
function authorLine(authors: string[]): string {
  const surnames = authors.map((a) => a.split(" ").at(-1)!);
  return surnames.length > 3 ? `${surnames[0]} et al.` : surnames.join(", ").replace(/, ([^,]+)$/, " and $1");
}

async function addToIndex(book: LibraryBook) {
  await putFile(book);
  return Response.json({ book });
}
