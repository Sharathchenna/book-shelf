import { requireOwner } from "@/lib/auth/session";
import { keys, readIndex, validId, writeIndex } from "@/lib/library";
import type { Highlight, Progress } from "@/lib/library-types";
import { shelf } from "@/lib/shelf";
import { getJson, getStorage } from "@/lib/storage";

/** Everything the reader needs to open a book: metadata, a short-lived file URL, position and notes. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const book = validId(id) ? (await readIndex()).find((b) => b.id === id) : undefined;
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });

  const storage = getStorage();
  const [fileUrl, progress, notes] = await Promise.all([
    storage.downloadUrl(keys.file(book)),
    getJson<Progress>(keys.progress(id)),
    getJson<Highlight[]>(keys.notes(id)),
  ]);
  return Response.json(
    { book, fileUrl, progress, notes: notes ?? [] },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Link (or unlink) the book to a shelf book. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const { shelfItemId } = (await request.json().catch(() => ({}))) as { shelfItemId?: unknown };
  if (shelfItemId !== null && !shelf.items.some((i) => i.id === shelfItemId)) {
    return Response.json({ error: "Unknown shelf book." }, { status: 400 });
  }

  const books = await readIndex();
  const book = books.find((b) => b.id === id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  book.shelfItemId = (shelfItemId as string | null) ?? undefined;
  await writeIndex(books);
  return Response.json({ book });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/books/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const books = await readIndex();
  const book = books.find((b) => b.id === id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });

  await writeIndex(books.filter((b) => b.id !== id));
  const storage = getStorage();
  await Promise.all(
    [keys.file(book), keys.text(id), keys.progress(id), keys.notes(id), book.coverKey]
      .filter((key): key is string => Boolean(key))
      .map((key) => storage.delete(key)),
  );
  return new Response(null, { status: 204 });
}
