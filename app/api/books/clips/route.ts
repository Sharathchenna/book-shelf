import { requireOwner } from "@/lib/auth/session";
import { readableClip } from "@/lib/clippings";
import { getClipping } from "@/lib/data";
import { listFiles } from "@/lib/library";
import { ARTICLE_EPUB_BUILD } from "@/lib/library-types";

/**
 * "Read" on a clipped article (an X Article, or an article or newsletter issue from anywhere): its
 * ebook in the library, or what the browser needs to make one (x-article-epub.ts builds it from
 * /api/books/clips/source, then uploads it like any EPUB).
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { clipId } = (await request.json().catch(() => ({}))) as { clipId?: unknown };
  const clip = typeof clipId === "string" ? await getClipping(clipId) : null;
  if (!clip || !readableClip(clip)) return Response.json({ error: "That isn't an article." }, { status: 404 });

  const files = (await listFiles()).filter((b) => b.clipId === clip.id);
  const current = files.find((b) => (b.build ?? 1) >= ARTICLE_EPUB_BUILD);
  if (current) return Response.json({ id: current.id, ready: true });
  // Made by an older conversion: built again, the new copy takes the old one's highlights and place (/api/books/[id]/adopt), and the old copy goes.
  return Response.json({ build: "epub", replaces: files.map((b) => b.id) });
}
