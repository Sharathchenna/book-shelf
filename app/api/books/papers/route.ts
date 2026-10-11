import { requireOwner } from "@/lib/auth/session";
import { getClipping } from "@/lib/data";
import { CONTENT_TYPES, keys, listFiles } from "@/lib/library";
import { getStorage, MAX_BOOK_BYTES } from "@/lib/storage";

/**
 * Puts a clipped paper's free PDF (arXiv, open proceedings) into the library, so "Read" needs no
 * upload. Returns the book id. If the paper isn't in the library yet, the server fetches and stores
 * the PDF, then the browser reads it and calls finalize, exactly as after an upload.
 * The URL comes from the stored clipping, never from the request.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { paperId, format } = (await request.json().catch(() => ({}))) as { paperId?: unknown; format?: unknown };
  const clip = typeof paperId === "string" ? await getClipping(paperId) : null;
  const paper = clip?.kind === "paper" ? clip : undefined;
  if (!paper?.paper?.pdf) return Response.json({ error: "That paper has no free PDF to read." }, { status: 404 });

  const files = (await listFiles()).filter((b) => b.paperId === paper.id);
  const ebook = files.find((b) => b.format === "epub");
  if (ebook) return Response.json({ id: ebook.id, ready: true });
  // arXiv papers read best as ebooks: the browser builds one from arXiv's HTML version (falling
  // back to the PDF when there's none), replacing a PDF copy added before.
  if (format !== "pdf" && paper.paper.arxiv) {
    return Response.json({
      build: "epub",
      arxiv: paper.paper.arxiv,
      title: paper.title,
      authors: paper.paper.authors,
      replaces: files.map((b) => b.id),
    });
  }
  const existing = files[0];
  if (existing) return Response.json({ id: existing.id, ready: true });

  let bytes: Uint8Array;
  try {
    const res = await fetch(paper.paper.pdf, {
      headers: { "User-Agent": "book-shelf/0.1 (personal reading room)", Accept: "application/pdf" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`${new URL(paper.paper.pdf).host} answered ${res.status}`);
    if (Number(res.headers.get("content-length")) > MAX_BOOK_BYTES) throw new Error("The PDF is over 100 MB");
    bytes = new Uint8Array(await res.arrayBuffer());
  } catch (error) {
    return Response.json({ error: `Couldn't fetch the PDF: ${(error as Error).message}.` }, { status: 502 });
  }
  // "%PDF": a login wall or an HTML landing page is not a paper.
  if (bytes.byteLength > MAX_BOOK_BYTES || String.fromCharCode(...bytes.subarray(0, 4)) !== "%PDF") {
    return Response.json({ error: "That link didn't lead to a PDF." }, { status: 502 });
  }

  // One id per paper, so retrying after an interrupted import overwrites rather than duplicates.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`paper:${paper.id}`));
  const id = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 20);
  const storage = getStorage();
  const key = keys.file({ id, format: "pdf" });
  await storage.put(key, bytes, CONTENT_TYPES.pdf);
  return Response.json({ id, ready: false, fileUrl: await storage.downloadUrl(key) });
}
