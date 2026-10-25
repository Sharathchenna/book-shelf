import { requireOwner } from "@/lib/auth/session";
import { tweetId } from "@/lib/clip";
import { readableClip } from "@/lib/clippings";
import { getClipping } from "@/lib/data";
import { feedContentKey } from "@/lib/feeds";
import { mediaArticle } from "@/lib/media";
import { getStorage } from "@/lib/storage";
import { fetchXArticle } from "@/lib/x-article";

const PAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; book-shelf-reader/0.1; personal reading shelf)",
  Accept: "text/html,application/xhtml+xml",
};
const MAX_CHARS = 6_000_000;

/**
 * A clipped article's full content, for the ebook the browser makes of it, fetched fresh so edits
 * show: an X Article's blocks, a video's or episode's player and transcript (lib/media.ts), or
 * another article's page as it is, which the browser reads (app/components/reader/web-article.ts).
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const clip = await getClipping(new URL(request.url).searchParams.get("clipId") ?? "");
  if (!clip || !readableClip(clip)) return Response.json({ error: "That isn't an article." }, { status: 404 });
  // A video or an episode: its player, description and transcript, as an article's blocks.
  if (clip.media) return Response.json(await mediaArticle(clip), { headers: { "cache-control": "no-store" } });
  if (!clip.xArticle) {
    const res = await fetch(clip.url, { headers: PAGE_HEADERS, redirect: "follow", signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return Response.json({ error: res ? `The site answered ${res.status}.` : "The site didn't answer." }, { status: 502 });
    if (!(res.headers.get("content-type") ?? "").includes("html")) return Response.json({ error: "That link isn't a web page." }, { status: 422 });
    const { id, url, title, author, source, excerpt, image, published } = clip;
    // From a feed: the post as the feed had it, for a page with too little on it to read.
    const fed = clip.via === "feed" ? await getStorage().getBytes(feedContentKey(clip.id)).catch(() => null) : null;
    return Response.json(
      {
        html: (await res.text()).slice(0, MAX_CHARS),
        url: res.url || clip.url,
        clip: { id, url, title, author, source, excerpt, image, published },
        ...(fed ? { fallback: new TextDecoder().decode(fed) } : {}),
      },
      { headers: { "cache-control": "no-store" } },
    );
  }
  const id = tweetId(clip.url);
  const article = id ? await fetchXArticle(id) : null;
  if (!article) return Response.json({ error: "X didn't send the article. It may be deleted, or X changed how it shares articles." }, { status: 502 });
  return Response.json(article, { headers: { "cache-control": "no-store" } });
}
