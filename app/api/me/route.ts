import { isOwner, ownerConfigured } from "@/lib/auth/session";
import { keys, readIndex, shelfItemFor } from "@/lib/library";
import type { Progress } from "@/lib/library-types";
import { getJson } from "@/lib/storage";

/**
 * Who is looking at the (static) shelf page, and which shelf books have an EPUB or PDF to read.
 * Everyone learns which books have one (visitors see them locked); only the owner also gets
 * how far through each one they are.
 */
export async function GET() {
  const owner = await isOwner();
  const books = await readIndex().catch(() => []);
  const library = await Promise.all(
    books.map(async (book) => ({
      id: book.id,
      shelfItemId: shelfItemFor(book),
      fraction: owner ? ((await getJson<Progress>(keys.progress(book.id)))?.fraction ?? 0) : 0,
    })),
  );
  return Response.json(
    { owner, loginAvailable: ownerConfigured(), library },
    { headers: { "cache-control": "no-store" } },
  );
}
