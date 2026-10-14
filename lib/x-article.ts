import "server-only";
import type { XArticle, XArticleBlock, XArticlePost } from "./x-article-types";

/**
 * Reads an X Article whole. X's public embeds and FxTwitter give only an article's title and
 * first lines, so this asks X's own web API, as a logged-out visitor does: a guest token from the
 * bearer token X's web app ships with, then the post with its article's rich content. X changes
 * that API now and then (the query id below); when it does, this returns null and the article
 * can still be clipped, just not read here.
 */

const BEARER = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const TWEET_QUERY = "0aTrQMKgj95K791yXeNDRA";
// X answers "page does not exist" to some clients' default user agents (Node's, for one).
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const FEATURES = {
  articles_preview_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  view_counts_everywhere_api_enabled: true,
};
/** Posts an article embeds are looked up (for their text), up to this many. */
const MAX_POSTS = 12;

let guest: { token: string; until: number } | null = null;

async function guestToken(fresh = false): Promise<string | null> {
  if (guest && !fresh && guest.until > Date.now()) return guest.token;
  const res = await fetch("https://api.x.com/1.1/guest/activate.json", {
    method: "POST",
    headers: { authorization: `Bearer ${BEARER}`, "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  const token = res?.ok ? ((await res.json()) as { guest_token?: string }).guest_token : undefined;
  guest = token ? { token, until: Date.now() + 2 * 3600_000 } : null;
  return token ?? null;
}

type Media = { media_id?: string; media_info?: { original_img_url?: string; original_img_width?: number; original_img_height?: number } };
type RawBlock = {
  type: string;
  text: string;
  depth?: number;
  inlineStyleRanges?: { offset: number; length: number; style: string }[];
  entityRanges?: { offset: number; length: number; key: number | string }[];
};
type Entity = { type: string; data?: Record<string, unknown> };
type RawArticle = {
  title?: string;
  preview_text?: string;
  cover_media?: Media;
  media_entities?: Media[];
  metadata?: { first_published_at_secs?: number };
  content_state?: { blocks?: RawBlock[]; entityMap?: { key: string; value: Entity }[] | Record<string, Entity> };
};
type RawUser = {
  core?: { name?: string; screen_name?: string };
  avatar?: { image_url?: string };
  legacy?: { name?: string; screen_name?: string; profile_image_url_https?: string };
};
type RawTweet = {
  __typename?: string;
  tweet?: RawTweet;
  rest_id?: string;
  legacy?: { created_at?: string };
  core?: { user_results?: { result?: RawUser } };
  article?: { article_results?: { result?: RawArticle } };
};

async function fetchTweet(id: string): Promise<RawTweet | null> {
  const q = (o: object) => encodeURIComponent(JSON.stringify(o));
  const variables = { tweetId: id, withCommunity: false, includePromotedContent: false, withVoice: false };
  const toggles = { withArticleRichContentState: true, withArticlePlainText: false };
  const url = `https://api.x.com/graphql/${TWEET_QUERY}/TweetResultByRestId?variables=${q(variables)}&features=${q(FEATURES)}&fieldToggles=${q(toggles)}`;
  for (const fresh of [false, true]) {
    const token = await guestToken(fresh);
    if (!token) return null;
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${BEARER}`, "x-guest-token": token, "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    // An expired or refused guest token: try once more with a new one.
    if (res && (res.status === 401 || res.status === 403 || res.status === 429) && !fresh) continue;
    if (!res?.ok) return null;
    const data = (await res.json().catch(() => null)) as { data?: { tweetResult?: { result?: RawTweet } } } | null;
    const result = data?.data?.tweetResult?.result;
    return result?.__typename === "TweetWithVisibilityResults" ? (result.tweet ?? null) : (result ?? null);
  }
  return null;
}

/** X's largest size that isn't the original: plenty for a page, and a fraction of the bytes. */
const large = (src: string) => (/^https:\/\/pbs\.twimg\.com\/media\//.test(src) && !src.includes("?") ? `${src}?name=large` : src);

/** A post an article embeds, by FxTwitter: who wrote it and what it says. */
async function embeddedPost(id: string): Promise<XArticlePost> {
  const url = `https://x.com/i/status/${id}`;
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { signal: AbortSignal.timeout(6000) }).catch(() => null);
  const post = res?.ok ? ((await res.json()) as { tweet?: { text?: string; author?: { name?: string; screen_name?: string } } }).tweet : undefined;
  if (!post?.author?.screen_name) return { url };
  return { url: `https://x.com/${post.author.screen_name}/status/${id}`, name: post.author.name, handle: post.author.screen_name, text: post.text };
}

/** The article published as post `tweetId`, or null when there's none or X won't say. */
export async function fetchXArticle(tweetId: string): Promise<XArticle | null> {
  const tweet = await fetchTweet(tweetId);
  const raw = tweet?.article?.article_results?.result;
  const user = tweet?.core?.user_results?.result;
  if (!raw?.title || !raw.content_state?.blocks || !user) return null;

  const handle = user.core?.screen_name ?? user.legacy?.screen_name ?? "";
  const name = user.core?.name ?? user.legacy?.name ?? handle;
  const avatar = (user.avatar?.image_url ?? user.legacy?.profile_image_url_https)?.replace("_normal.", "_200x200.");

  const media = new Map((raw.media_entities ?? []).map((m) => [m.media_id ?? "", m.media_info]));
  const map = raw.content_state.entityMap ?? [];
  const entities = new Map<string, Entity>(Array.isArray(map) ? map.map((e) => [String(e.key), e.value]) : Object.entries(map));

  const posts: { block: XArticleBlock; id: string }[] = [];
  const blocks: XArticleBlock[] = raw.content_state.blocks.map((b) => {
    const block: XArticleBlock = {
      type: b.type,
      text: b.text ?? "",
      depth: b.depth ?? 0,
      styles: (b.inlineStyleRanges ?? []).map(({ offset, length, style }) => ({ offset, length, style })),
      links: [],
    };
    for (const range of b.entityRanges ?? []) {
      const entity = entities.get(String(range.key));
      const data = entity?.data ?? {};
      if (entity?.type === "LINK" && typeof data.url === "string") {
        block.links.push({ offset: range.offset, length: range.length, url: data.url });
      } else if (entity?.type === "MEDIA") {
        const items = (data.mediaItems as { mediaId?: string }[] | undefined) ?? [];
        block.media = items
          .map((item) => media.get(item.mediaId ?? ""))
          .filter((info) => info?.original_img_url)
          .map((info) => ({ src: large(info!.original_img_url!), width: info!.original_img_width, height: info!.original_img_height }));
      } else if (entity?.type === "TWEET" && typeof data.tweetId === "string") {
        posts.push({ block, id: data.tweetId });
      } else if (entity?.type === "MARKDOWN" && typeof data.markdown === "string") {
        block.code = data.markdown;
      } else if (entity?.type === "DIVIDER") {
        block.divider = true;
      }
    }
    return block;
  });
  await Promise.all(posts.slice(0, MAX_POSTS).map(async (p) => (p.block.post = await embeddedPost(p.id))));

  const cover = raw.cover_media?.media_info?.original_img_url;
  const published = raw.metadata?.first_published_at_secs
    ? new Date(raw.metadata.first_published_at_secs * 1000)
    : tweet?.legacy?.created_at
      ? new Date(tweet.legacy.created_at)
      : undefined;
  return {
    id: tweetId,
    url: `https://x.com/${handle}/status/${tweetId}`,
    title: raw.title,
    preview: raw.preview_text ?? "",
    cover: cover && large(cover),
    published: published && !Number.isNaN(published.getTime()) ? published.toISOString().slice(0, 10) : undefined,
    author: { name, handle, avatar },
    blocks,
  };
}
