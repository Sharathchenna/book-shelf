import { isOwner, ownerConfigured } from "@/lib/auth/session";
import { readIndex, keys } from "@/lib/library";
import type { Progress } from "@/lib/library-types";
import { getJson } from "@/lib/storage";

/**
 * Who is looking at the (static) shelf page. Visitors get { owner: false }; the owner also
 * gets which shelf books have an EPUB and how far through each one they are.
 */
export async function GET() {
  if (!(await isOwner())) {
    return Response.json({ owner: false, loginAvailable: ownerConfigured() }, { headers: { "cache-control": "no-store" } });
  }
  const books = await readIndex();
  const library = await Promise.all(
    books.map(async (book) => ({
      id: book.id,
      shelfItemId: book.shelfItemId,
      fraction: (await getJson<Progress>(keys.progress(book.id)))?.fraction ?? 0,
    })),
  );
  return Response.json({ owner: true, library }, { headers: { "cache-control": "no-store" } });
}
