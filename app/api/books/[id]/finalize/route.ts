import { requireOwner } from "@/lib/auth/session";
import { parseEpub } from "@/lib/epub/parse";
import { keys, matchShelfItem, readIndex, validId, writeIndex } from "@/lib/library";
import type { LibraryBook } from "@/lib/library-types";
import { getStorage, MAX_EPUB_BYTES, putJson } from "@/lib/storage";

/**
 * After the browser has uploaded the EPUB: read its metadata, cover and text, match it to a
 * shelf book, and add it to the library index.
 */
export async function POST(_request: Request, ctx: RouteContext<"/api/books/[id]/finalize">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const storage = getStorage();
  const bytes = await storage.getBytes(keys.epub(id));
  if (!bytes) return Response.json({ error: "The upload didn't arrive. Try again." }, { status: 404 });
  if (bytes.byteLength > MAX_EPUB_BYTES) {
    await storage.delete(keys.epub(id));
    return Response.json({ error: "EPUBs up to 100 MB only." }, { status: 413 });
  }

  let parsed;
  try {
    parsed = await parseEpub(bytes);
  } catch (error) {
    await storage.delete(keys.epub(id));
    return Response.json({ error: (error as Error).message || "That file couldn't be read as an EPUB." }, { status: 422 });
  }

  let coverKey: string | undefined;
  if (parsed.cover) {
    coverKey = keys.cover(id, parsed.cover.ext);
    await storage.put(coverKey, parsed.cover.bytes, parsed.cover.type);
  }
  await putJson(keys.text(id), parsed.sections.map((s) => s.text));

  const book: LibraryBook = {
    id,
    title: parsed.title,
    author: parsed.author,
    shelfItemId: matchShelfItem(parsed.title, parsed.author),
    coverKey,
    sections: parsed.sections.map((s) => ({ title: s.title, chars: s.text.length })),
    totalChars: parsed.sections.reduce((sum, s) => sum + s.text.length, 0),
    bytes: bytes.byteLength,
    addedAt: new Date().toISOString(),
  };
  await writeIndex([...(await readIndex()).filter((b) => b.id !== id), book]);
  return Response.json({ book });
}
