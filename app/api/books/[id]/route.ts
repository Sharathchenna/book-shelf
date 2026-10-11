import { requireOwner } from "@/lib/auth/session";
import { getClipping, getShelf } from "@/lib/data";
import { getFile, getNotes, getProgress, keys, putFile, removeFile, shelfItemFor } from "@/lib/library";
import { getStorage } from "@/lib/storage";

/** Everything the reader needs to open a book: metadata, a short-lived file URL, position and notes. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const book = await getFile(id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });

  const [fileUrl, progress, notes, { items }, paper] = await Promise.all([
    getStorage().downloadUrl(keys.file(book)),
    getProgress(id),
    getNotes(id),
    getShelf(),
    book.paperId ? getClipping(book.paperId) : null,
  ]);
  return Response.json(
    {
      book: { ...book, shelfItemId: shelfItemFor(book, items) },
      fileUrl,
      progress,
      notes,
      // A paper read as an ebook keeps its original PDF a click away.
      original: paper?.paper?.pdf,
    },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Link (or unlink) the file to a shelf book. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const { shelfItemId } = (await request.json().catch(() => ({}))) as { shelfItemId?: unknown };
  const { items } = await getShelf();
  if (shelfItemId !== null && !items.some((i) => i.id === shelfItemId)) {
    return Response.json({ error: "Unknown shelf book." }, { status: 400 });
  }

  const book = await getFile(id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  book.shelfItemId = (shelfItemId as string | null) ?? undefined;
  await putFile(book);
  return Response.json({ book });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const book = await getFile(id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });

  await removeFile(id);
  const storage = getStorage();
  await Promise.all(
    [keys.file(book), keys.text(id), book.coverKey]
      .filter((key): key is string => Boolean(key))
      .map((key) => storage.delete(key)),
  );
  return new Response(null, { status: 204 });
}
