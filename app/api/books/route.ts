import { randomUUID } from "node:crypto";
import { isOwner, requireOwner } from "@/lib/auth/session";
import { CONTENT_TYPES, keys, readIndex } from "@/lib/library";
import type { LibraryEntry, Progress } from "@/lib/library-types";
import { getJson, getStorage, MAX_BOOK_BYTES } from "@/lib/storage";

/**
 * The library, most recently read first. It's on show to everyone (locked), so visitors get each
 * book's title, author and cover; the owner also gets their progress. The files stay owner-only.
 */
export async function GET() {
  const owner = await isOwner();
  const storage = getStorage();
  const entries: LibraryEntry[] = await Promise.all(
    (await readIndex()).map(async (book) => ({
      ...book,
      progress: owner ? ((await getJson<Progress>(keys.progress(book.id))) ?? undefined) : undefined,
      coverUrl: book.coverKey ? await storage.downloadUrl(book.coverKey) : undefined,
    })),
  );
  entries.sort((a, b) =>
    (b.progress?.updatedAt ?? b.addedAt).localeCompare(a.progress?.updatedAt ?? a.addedAt),
  );
  return Response.json(
    { books: entries, owner, storage: owner ? storage.kind : undefined },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * Starts an upload: returns a new book id and a short-lived URL the browser PUTs the EPUB or PDF
 * to (straight to R2). The client then calls POST /api/books/[id]/finalize.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { bytes, name } = (await request.json().catch(() => ({}))) as { bytes?: unknown; name?: unknown };
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    return Response.json({ error: "Missing file size." }, { status: 400 });
  }
  if (bytes > MAX_BOOK_BYTES) return Response.json({ error: "Files up to 100 MB only." }, { status: 413 });
  const format = typeof name === "string" ? name.toLowerCase().match(/\.(epub|pdf)$/)?.[1] : undefined;
  if (format !== "epub" && format !== "pdf") {
    return Response.json({ error: "Only .epub and .pdf files can be added." }, { status: 415 });
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  const contentType = CONTENT_TYPES[format];
  const uploadUrl = await getStorage().uploadUrl(keys.file({ id, format }), contentType, bytes);
  return Response.json({ id, format, uploadUrl, contentType });
}
