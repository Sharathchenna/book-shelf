import { requireOwner } from "@/lib/auth/session";
import { getClippings, getShelf } from "@/lib/data";
import type { NotesMeta } from "@/lib/export";
import { allNotes, listFiles, shelfItemFor } from "@/lib/library";

/**
 * Every book with highlights, and what the Markdown export needs about it (lib/export.ts). The
 * browser writes the files and the zip, so the Worker only reads.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [notes, files, { items }, { items: clips }] = await Promise.all([allNotes(), listFiles(), getShelf(), getClippings()]);
  const clipById = new Map(clips.map((c) => [c.id, c]));
  const books = files.flatMap((file) => {
    const highlights = notes.get(file.id) ?? [];
    if (!highlights.length) return [];
    const clip = clipById.get(file.paperId ?? file.clipId ?? "");
    const item = items.find((i) => i.id === shelfItemFor(file, items));
    const meta: NotesMeta = {
      title: file.title,
      ...(file.author ? { author: file.author } : {}),
      kind: file.paperId ? "paper" : clip?.kind === "tweet" ? "post" : file.clipId ? "article" : "book",
      ...(clip ? { url: clip.url } : item?.goodreadsId ? { url: `https://www.goodreads.com/book/show/${item.goodreadsId}` } : {}),
      sections: file.sections.map((s) => s.title),
    };
    return [{ meta, highlights }];
  });
  return Response.json({ books }, { headers: { "cache-control": "no-store" } });
}
