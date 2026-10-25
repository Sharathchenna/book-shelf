import { requireOwner } from "@/lib/auth/session";
import { TOPICS } from "@/lib/bookcase";
import { shelfItemFor } from "@/lib/library";
import { ownerLibrary } from "@/lib/owner-library";
import { shelfConfig } from "@/shelf.config";

/**
 * The whole library as data, for the Android app: every book and clipping as the bookcase draws
 * it (with each spine's look, so it's drawn the same), with the owner's reading laid over it as
 * the home page does from /api/me, and where each stands in their Inbox, Later and Archive; the
 * Goodreads books and the clippings behind the cards; and the reader's files with where the owner
 * is in each. Answered with an ETag, so a device that already has this version gets a 304.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { updatedAt, books, items, clips, files, progress } = await ownerLibrary();
  const body = JSON.stringify({
    owner: shelfConfig.owner,
    updatedAt,
    topics: TOPICS.map(({ key, name, shades, blurb }) => ({ key, name, shades, blurb })),
    books,
    items,
    clips,
    files: files.map((file) => ({ ...file, shelfItemId: shelfItemFor(file, items), progress: progress.get(file.id) })),
  });
  const etag = `"${await digest(body)}"`;
  const headers = { etag, "cache-control": "private, no-cache", "content-type": "application/json" };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers });
}

async function digest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
