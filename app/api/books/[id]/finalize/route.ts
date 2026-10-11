import { requireOwner } from "@/lib/auth/session";
import { clippings } from "@/lib/clippings";
import { parseEpub } from "@/lib/epub/parse";
import { keys, matchShelfItem, readIndex, validId, writeIndex } from "@/lib/library";
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
  return body.format === "pdf" ? finalizePdf(id, body) : finalizeEpub(id);
}

async function finalizeEpub(id: string) {
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

  return addToIndex({
    id,
    format: "epub",
    title: parsed.title,
    author: parsed.author,
    shelfItemId: matchShelfItem(parsed.title, parsed.author),
    coverKey,
    sections: parsed.sections.map((s) => ({ title: s.title, chars: s.text.length })),
    totalChars: parsed.sections.reduce((sum, s) => sum + s.text.length, 0),
    bytes: bytes.byteLength,
    addedAt: new Date().toISOString(),
  });
}

async function finalizePdf(id: string, body: Record<string, unknown>) {
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

  // A clipped paper names itself; otherwise take what the browser read from the PDF or its file name.
  const paper = typeof body.paperId === "string" ? clippings.items.find((c) => c.id === body.paperId && c.kind === "paper") : undefined;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fallback);
  const title = paper?.title ?? text(body.title, "Untitled PDF");
  const author = paper?.paper?.authors.length ? authorLine(paper.paper.authors) : text(body.author, "");

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
    shelfItemId: paper ? undefined : matchShelfItem(title, author),
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
  await writeIndex([...(await readIndex()).filter((b) => b.id !== book.id), book]);
  return Response.json({ book });
}
