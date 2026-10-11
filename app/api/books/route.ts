import { randomUUID } from "node:crypto";
import { requireOwner } from "@/lib/auth/session";
import { CONTENT_TYPES, keys } from "@/lib/library";
import { getStorage, MAX_BOOK_BYTES } from "@/lib/storage";

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
