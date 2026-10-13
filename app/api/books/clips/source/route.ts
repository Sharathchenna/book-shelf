import { requireOwner } from "@/lib/auth/session";
import { tweetId } from "@/lib/clip";
import { getClipping } from "@/lib/data";
import { fetchXArticle } from "@/lib/x-article";

/** A clipped X Article's full content, for the ebook the browser makes of it. Fetched fresh, so edits show. */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const clip = await getClipping(new URL(request.url).searchParams.get("clipId") ?? "");
  const id = clip?.xArticle ? tweetId(clip.url) : undefined;
  if (!clip || !id) return Response.json({ error: "That isn't an X Article." }, { status: 404 });
  const article = await fetchXArticle(id);
  if (!article) return Response.json({ error: "X didn't send the article. It may be deleted, or X changed how it shares articles." }, { status: 502 });
  return Response.json(article, { headers: { "cache-control": "no-store" } });
}
