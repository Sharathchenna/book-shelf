import { isOwner, ownerConfigured } from "@/lib/auth/session";
import { getShelf } from "@/lib/data";
import { allProgress, highlightCounts, listFiles, shelfItemFor } from "@/lib/library";

/**
 * Who is looking at the (static) shelf page, and which shelf books have an EPUB or PDF to read.
 * Everyone learns which books have one (visitors see them locked); only the owner also gets
 * how far through each one they are, and how many highlights each holds.
 */
export async function GET() {
  const owner = await isOwner();
  const [files, { items }, progress, marks] = await Promise.all([
    listFiles(),
    getShelf(),
    owner ? allProgress() : new Map(),
    owner ? highlightCounts() : new Map<string, number>(),
  ]);
  const library = files.map((book) => ({
    id: book.id,
    shelfItemId: shelfItemFor(book, items),
    ...(book.paperId ? { paperId: book.paperId } : {}),
    ...(book.clipId ? { clipId: book.clipId } : {}),
    fraction: progress.get(book.id)?.fraction ?? 0,
    ...(owner ? { highlights: marks.get(book.id) ?? 0 } : {}),
  }));
  return Response.json(
    { owner, loginAvailable: ownerConfigured(), library },
    { headers: { "cache-control": "no-store" } },
  );
}
