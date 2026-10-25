import { requireOwner } from "@/lib/auth/session";
import { embeddedPost } from "@/lib/x-article";

/**
 * A post on X that a clipped article embeds, for the ebook the browser makes of it
 * (app/components/reader/x-article-epub.ts): the page only has its text and a link, X's script
 * draws the rest. Who wrote it, when, and its pictures and videos.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^\d{1,25}$/.test(id)) return Response.json({ error: "Bad post id." }, { status: 400 });
  return Response.json(await embeddedPost(id), { headers: { "cache-control": "private, max-age=3600" } });
}
