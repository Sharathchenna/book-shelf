/**
 * Adds articles, newsletter issues and tweets to data/clippings.json.
 *
 *   bun run clip <url> [<url> ...] [--note "Why it's worth keeping"] [--tags design,essays]
 *                [--kind article|newsletter|tweet] [--saved 2026-10-11]
 *   bun run clip --remove <url>
 *
 * Articles are described from their Open Graph and JSON-LD metadata, newsletters are recognised
 * by their platform (Substack, Buttondown, beehiiv, ...), and tweets are fetched from X's public
 * embed endpoints and stored as plain data, so the site renders them without X's scripts.
 * Adding a URL that is already clipped refreshes it, keeping its note, tags and saved date
 * unless new ones are given.
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import type { Clip, ClipKind, ClippingsData } from "../lib/types";

const OUT = "data/clippings.json";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; book-shelf-clipper/0.1; personal reading shelf)",
  Accept: "text/html,application/xhtml+xml",
};
const WORDS_PER_MINUTE = 230;

const NEWSLETTER_HOSTS = [
  /(^|\.)substack\.com$/,
  /(^|\.)buttondown\.(email|com)$/,
  /(^|\.)beehiiv\.com$/,
  /(^|\.)mailchi\.mp$/,
  /(^|\.)kit\.com$/,
  /(^|\.)convertkit\.com$/,
  /(^|\.)ghost\.io$/,
  /(^|\.)tinyletter\.com$/,
  /(^|\.)every\.to$/,
  /(^|\.)stratechery\.com$/,
];
/** Substack and beehiiv on custom domains still load their own assets. (Not signup forms: blogs embed those too.) */
const NEWSLETTER_MARKERS = /substackcdn\.com|media\.beehiiv\.com/;

type Options = { note?: string; tags?: string[]; kind?: ClipKind; saved?: string; remove: boolean };

async function main() {
  const { urls, options } = parseArgs(process.argv.slice(2));
  if (urls.length === 0) {
    console.log('Usage: bun run clip <url> [<url> ...] [--note "..."] [--tags a,b] [--kind article|newsletter|tweet]');
    process.exit(1);
  }

  const data: ClippingsData = existsSync(OUT) ? JSON.parse(await readFile(OUT, "utf8")) : { items: [] };

  for (const url of urls) {
    const id = clipId(url);
    const existing = data.items.find((c) => c.id === id || clipId(c.url) === id);

    if (options.remove) {
      data.items = data.items.filter((c) => c !== existing);
      console.log(existing ? `Removed ${existing.title ?? existing.url}` : `Not clipped: ${url}`);
      continue;
    }

    try {
      const fetched = tweetId(url) ? await fetchTweet(url) : await fetchPage(url, options.kind);
      const clip: Clip = {
        ...fetched,
        id: existing?.id ?? id,
        kind: options.kind ?? fetched.kind,
        saved: options.saved ?? existing?.saved ?? new Date().toISOString().slice(0, 10),
        note: options.note ?? existing?.note,
        tags: options.tags ?? existing?.tags ?? [],
      };
      if (!clip.note) delete clip.note;
      data.items = [clip, ...data.items.filter((c) => c !== existing)];
      const label = clip.kind === "tweet" ? `@${clip.tweet?.handle}: ${clip.tweet?.text.slice(0, 60)}` : clip.title;
      console.log(`${existing ? "Refreshed" : "Clipped"} ${clip.kind}: ${label}`);
    } catch (error) {
      console.warn(`  could not clip ${url}: ${(error as Error).message}`);
    }
  }

  data.items.sort((a, b) => b.saved.localeCompare(a.saved));
  await writeFile(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`Wrote ${OUT}: ${data.items.length} clippings.`);
}

function parseArgs(args: string[]): { urls: string[]; options: Options } {
  const urls: string[] = [];
  const options: Options = { remove: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--note") options.note = args[++i];
    else if (arg === "--tags")
      options.tags = args[++i]
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    else if (arg === "--kind") options.kind = args[++i] as ClipKind;
    else if (arg === "--saved") options.saved = args[++i];
    else if (arg === "--remove") options.remove = true;
    else urls.push(arg);
  }
  return { urls, options };
}

/** Stable id from the URL without tracking parameters, fragment or trailing slash. */
function clipId(url: string): string {
  const tweet = tweetId(url);
  if (tweet) return `tweet-${tweet}`;
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref|source|s$|r$)/.test(key)) u.searchParams.delete(key);
  u.hash = "";
  const normal = `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  return createHash("sha1").update(normal).digest("hex").slice(0, 12);
}

function tweetId(url: string): string | undefined {
  return url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/)?.[1];
}

// ---- tweets ------------------------------------------------------------------------------------

type Syndicated = {
  __typename?: string;
  id_str: string;
  text: string;
  created_at: string;
  favorite_count?: number;
  display_text_range?: [number, number];
  user: { name: string; screen_name: string; profile_image_url_https?: string };
  entities?: { urls?: { url: string; expanded_url: string; display_url: string }[] };
  mediaDetails?: { type: string; media_url_https: string }[];
};

async function fetchTweet(url: string): Promise<Omit<Clip, "id" | "saved" | "tags">> {
  const id = tweetId(url)!;
  // The token X's own embed widget sends; derived from the id.
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
  const res = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}&lang=en`);
  const tweet = res.ok ? ((await res.json()) as Syndicated) : null;
  if (!tweet || tweet.__typename === "TweetTombstone" || !tweet.user) return fetchTweetOembed(url);

  const [start, end] = tweet.display_text_range ?? [0, Infinity];
  let text = Array.from(tweet.text).slice(start, end).join("");
  for (const link of tweet.entities?.urls ?? []) text = text.replace(link.url, link.expanded_url);
  text = decodeEntities(text).trim();

  return {
    kind: "tweet",
    url: `https://x.com/${tweet.user.screen_name}/status/${id}`,
    author: tweet.user.name,
    source: "X",
    published: tweet.created_at.slice(0, 10),
    tweet: {
      name: tweet.user.name,
      handle: tweet.user.screen_name,
      avatar: tweet.user.profile_image_url_https?.replace("_normal.", "_bigger."),
      text,
      media: (tweet.mediaDetails ?? []).map((m) => m.media_url_https),
      likes: tweet.favorite_count,
    },
  };
}

/** Fallback for tweets the syndication endpoint won't describe: X's oEmbed, text and author only. */
async function fetchTweetOembed(url: string): Promise<Omit<Clip, "id" | "saved" | "tags">> {
  const res = await fetch(`https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(`X returned ${res.status}; the tweet may be deleted or private`);
  const { html, author_name, author_url } = (await res.json()) as { html: string; author_name: string; author_url: string };
  const text = decodeEntities(
    (html.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "").replace(/<br\s*\/?>/g, "\n").replace(/<[^>]+>/g, ""),
  );
  const date = html.match(/>([A-Z][a-z]+ \d{1,2}, \d{4})<\/a><\/blockquote>/)?.[1];
  const handle = author_url.split("/").pop()!;
  return {
    kind: "tweet",
    url: `https://x.com/${handle}/status/${tweetId(url)}`,
    author: author_name,
    source: "X",
    published: date ? new Date(`${date} UTC`).toISOString().slice(0, 10) : undefined,
    tweet: { name: author_name, handle, text: text.trim(), media: [] },
  };
}

// ---- articles and newsletters --------------------------------------------------------------------

async function fetchPage(url: string, kind?: ClipKind): Promise<Omit<Clip, "id" | "saved" | "tags">> {
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  const meta = readMeta(html);
  const ld = readJsonLd(html);
  const finalUrl = new URL(meta["og:url"] || canonical(html) || res.url || url, res.url || url).toString();
  const host = new URL(finalUrl).host.replace(/^www\./, "");

  const newsletter =
    NEWSLETTER_HOSTS.some((re) => re.test(host)) ||
    NEWSLETTER_MARKERS.test(html) ||
    /substack|beehiiv|buttondown/i.test(meta.generator ?? "");

  const title = clean(meta["og:title"] || meta["twitter:title"] || ld.headline || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  if (!title) throw new Error("no title found");
  const image = meta["og:image"] || meta["twitter:image"] || meta["twitter:image:src"];
  const published = (meta["article:published_time"] || ld.datePublished || meta["date"] || "").slice(0, 10);
  const words = countWords(html);

  return {
    kind: kind ?? (newsletter ? "newsletter" : "article"),
    url: finalUrl,
    title,
    author: person(ld.author, meta.author, meta["article:author"], meta["twitter:creator"]),
    source: clean(meta["og:site_name"] || ld.publisher || meta["application-name"]) || host,
    excerpt: meaningful(clean(meta["og:description"] || meta.description || meta["twitter:description"])),
    image: image ? new URL(decodeEntities(image), finalUrl).toString() : undefined,
    published: /^\d{4}-\d{2}-\d{2}$/.test(published) ? published : undefined,
    minutes: words > 150 ? Math.max(1, Math.round(words / WORDS_PER_MINUTE)) : undefined,
  };
}

/** <meta> tags keyed by property, name or itemprop. The first value for a key wins. */
function readMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3]]),
    );
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    if (key && attrs.content && !(key in meta)) meta[key] = attrs.content;
  }
  return meta;
}

function readJsonLd(html: string): { headline?: string; author?: string; publisher?: string; datePublished?: string } {
  for (const [, body] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(body);
      const nodes = [parsed, ...(Array.isArray(parsed) ? parsed : []), ...(parsed["@graph"] ?? [])].flat();
      const article = nodes.find((n) => n && /Article|Posting|Report/.test(String(n["@type"])));
      if (!article) continue;
      const author = [article.author].flat()[0];
      return {
        headline: article.headline,
        author: typeof author === "string" ? author : author?.name,
        publisher: article.publisher?.name,
        datePublished: article.datePublished,
      };
    } catch {
      // Malformed JSON-LD is common; the meta tags are enough.
    }
  }
  return {};
}

/** The first value that names a person: not a profile URL, without a leading @. */
function person(...values: (string | undefined)[]): string | undefined {
  return values.map((v) => clean(v)?.replace(/^@/, "")).find((v) => v && !/^https?:\/\//.test(v));
}

/** Drops placeholder descriptions such as "..." that some platforms emit. */
function meaningful(s: string | undefined): string | undefined {
  return s && (s.match(/\w/g)?.length ?? 0) >= 12 ? s : undefined;
}

function canonical(html: string): string | undefined {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
}

/** Words in the article body (or the page, without its scripts and chrome), for a reading time. */
function countWords(html: string): number {
  const body =
    html.match(/<article\b[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main\b[\s\S]*?<\/main>/i)?.[0] ?? html;
  const text = body
    .replace(/<(script|style|nav|header|footer|aside|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text).split(/\s+/).filter((w) => /\w/.test(w)).length;
}

function clean(s: string | undefined): string | undefined {
  return s ? decodeEntities(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim() : undefined;
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#"
      ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      : (named[e.toLowerCase()] ?? m),
  );
}

main();
