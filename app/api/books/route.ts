import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/session";
import { keys, readIndex } from "@/lib/library";
import type { LibraryEntry, Progress } from "@/lib/library-types";
import { getJson, getStorage, MAX_EPUB_BYTES } from "@/lib/storage";

/** The owner's EPUB library, most recently read first. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const storage = getStorage();
  const entries: LibraryEntry[] = await Promise.all(
    (await readIndex()).map(async (book) => ({
      ...book,
      progress: (await getJson<Progress>(keys.progress(book.id))) ?? undefined,
      coverUrl: book.coverKey ? await storage.downloadUrl(book.coverKey) : undefined,
    })),
  );
  entries.sort((a, b) =>
    (b.progress?.updatedAt ?? b.addedAt).localeCompare(a.progress?.updatedAt ?? a.addedAt),
  );
  return Response.json({ books: entries, storage: storage.kind }, { headers: { "cache-control": "no-store" } });
}

/**
 * Starts an upload: returns a new book id and a short-lived URL the browser PUTs the EPUB to
 * (straight to R2). The client then calls POST /api/books/[id]/finalize.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { bytes, name } = (await request.json().catch(() => ({}))) as { bytes?: unknown; name?: unknown };
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
    return Response.json({ error: "Missing file size." }, { status: 400 });
  }
  if (bytes > MAX_EPUB_BYTES) return Response.json({ error: "EPUBs up to 100 MB only." }, { status: 413 });
  if (typeof name !== "string" || !name.toLowerCase().endsWith(".epub")) {
    return Response.json({ error: "Only .epub files can be added." }, { status: 415 });
  }

  const id = randomUUID().replace(/-/g, "").slice(0, 20);
  const uploadUrl = await getStorage().uploadUrl(keys.epub(id), "application/epub+zip", bytes);
  return Response.json({ id, uploadUrl, contentType: "application/epub+zip" });
}
