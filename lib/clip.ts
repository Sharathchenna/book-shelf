import "server-only";
import { createHash } from "node:crypto";
import type { Clip, ClipKind, QuotedPost } from "./types";
import { fetchXArticle } from "./x-article";
import { articleMinutes } from "./x-article-types";

/**
 * Clipping a link: articles are described from their Open Graph and JSON-LD metadata, newsletters
 * are recognised by their platform (Substack, Buttondown, beehiiv, ...), tweets come from FxTwitter
 * (falling back to X's public embed endpoints) and are stored as plain data (so the site renders
 * them without X's scripts), X Articles become articles (read whole in the site's reader), and papers come from the arXiv API, Crossref (for DOIs), or the citation_* tags that
 * journals and proceedings sites publish for Google Scholar.
 */

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; book-shelf-clipper/0.1; personal reading shelf)",
  Accept: "text/html,application/xhtml+xml",
};
const API_HEADERS = { "User-Agent": HEADERS["User-Agent"], Accept: "application/json" };
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

export type ClipOptions = { kind?: ClipKind; note?: string; tags?: string[] };

/**
 * Fetches and describes a link (or "arxiv:<id>", or a bare DOI). Clipping one that's already
 * there refreshes its details but keeps its saved date, and its note and tags unless new ones
 * are given. Throws with a readable reason when the link can't be clipped.
 */
export async function clipLink(input: string, options: ClipOptions, existing?: Clip | null): Promise<Clip> {
  const url = expand(input.trim());
  if (!/^https?:\/\//i.test(url)) throw new Error("That doesn't look like a link.");
  const fetched = tweetId(url)
    ? await fetchTweet(url)
    : arxivId(url)
      ? await fetchArxiv(arxivId(url)!)
      : doiOf(url)
        ? await fetchCrossref(doiOf(url)!)
        : await fetchPage(url, options.kind);
  if (fetched.paper) await fillFromSemanticScholar(fetched);

  const clip: Clip = {
    ...fetched,
    id: existing?.id ?? clipId(url),
    kind: options.kind ?? fetched.kind,
    saved: existing?.saved ?? new Date().toISOString().slice(0, 10),
    note: options.note?.trim() || existing?.note,
    tags: options.tags ?? existing?.tags ?? [],
  };
  if (!clip.note) delete clip.note;
  return clip;
}

/**
 * Shorthands: "arxiv:1706.03762" and bare DOIs ("10.1038/nature14539") become URLs, and
 * arXiv's own DOIs (10.48550/arXiv.…) become arXiv links, so a paper has one id however it's clipped.
 */
export function expand(arg: string): string {
  const doi = arg.match(/^(?:https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/.+)$/i)?.[1];
  const arxiv = arg.match(/^arxiv:(.+)$/i)?.[1] ?? doi?.match(/^10\.48550\/arxiv\.(.+)$/i)?.[1];
  if (arxiv) return `https://arxiv.org/abs/${arxiv}`;
  if (doi) return `https://doi.org/${doi}`;
  return arg;
}

/** Stable id from the URL without tracking parameters, fragment or trailing slash. */
export function clipId(url: string): string {
  const tweet = tweetId(url);
  if (tweet) return `tweet-${tweet}`;
  const arxiv = arxivId(url);
  if (arxiv) return `arxiv-${arxiv.replace("/", "-")}`;
  const u = new URL(url);
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|ref|source|s$|r$)/.test(key)) u.searchParams.delete(key);
  u.hash = "";
  const normal = `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  return createHash("sha1").update(normal).digest("hex").slice(0, 12);
}

export function tweetId(url: string): string | undefined {
  return url.match(/^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/]+\/status(?:es)?\/(\d+)/)?.[1];
}

/** "1706.03762" from abs, pdf and html links (any version), and old-style ids like "hep-th/9901001". */
function arxivId(url: string): string | undefined {
  return url.match(
    /^https?:\/\/(?:www\.|export\.)?(?:arxiv|alphaxiv)\.org\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z]{2})?\/\d{7})/i,
  )?.[1];
}

function doiOf(url: string): string | undefined {
  const doi = url.match(/^https?:\/\/(?:dx\.)?doi\.org\/(10\.\d{4,9}\/.+)$/i)?.[1];
  return doi && decodeURIComponent(doi);
}

// ---- papers --------------------------------------------------------------------------------------

type Fetched = Omit<Clip, "id" | "saved" | "tags">;

async function fetchArxiv(id: string): Promise<Fetched> {
  const res = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: HEADERS });
  if (!res.ok) throw new Error(`arXiv returned ${res.status}`);
  const entry = (await res.text()).match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  // Unknown ids come back as an entry whose id points at arXiv's error docs.
  if (!entry || entry.includes("arxiv.org/api/errors")) throw new Error(`arXiv has no paper ${id}`);
  const tag = (name: string) => clean(entry.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]);
  const authors = [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => clean(m[1])!);
  const published = tag("published")?.slice(0, 10);
  const doi = tag("arxiv:doi");

  return paperClip({
    url: `https://arxiv.org/abs/${id}`,
    title: tag("title"),
    authors,
    venue: tag("arxiv:journal_ref") ?? "arXiv",
    date: published,
    abstract: tag("summary"),
    arxiv: id,
    doi,
    pdf: `https://arxiv.org/pdf/${id}`,
  });
}

type CrossrefWork = {
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  "container-title"?: string[];
  publisher?: string;
  published?: { "date-parts": number[][] };
  issued?: { "date-parts": number[][] };
  abstract?: string;
};

async function fetchCrossref(doi: string): Promise<Fetched> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, { headers: API_HEADERS });
  if (!res.ok) throw new Error(`Crossref returned ${res.status} for ${doi}`);
  const work = ((await res.json()) as { message: CrossrefWork }).message;
  const parts = (work.published ?? work.issued)?.["date-parts"]?.[0] ?? [];

  return paperClip({
    url: `https://doi.org/${doi}`,
    title: clean(work.title?.[0]),
    authors: (work.author ?? []).map((a) => a.name ?? [a.given, a.family].filter(Boolean).join(" ")).filter(Boolean),
    venue: clean(work["container-title"]?.[0]) ?? clean(work.publisher),
    date: parts.map((n, i) => (i ? String(n).padStart(2, "0") : String(n))).join("-"),
    // JATS XML, usually opening with a "Abstract" heading.
    abstract: clean(work.abstract?.replace(/<jats:title>[\s\S]*?<\/jats:title>/, "")),
    doi,
  });
}

/** Journals and proceedings sites describe papers with Highwire citation_* tags, for Google Scholar. */
function citationPaper(html: string, url: string): Fetched | undefined {
  const tags = metaTags(html);
  const one = (...keys: string[]) => clean(keys.map((k) => tags.find(([key]) => key === k)?.[1]).find(Boolean));
  const title = one("citation_title");
  if (!title) return undefined;
  const pdf = one("citation_pdf_url");

  return paperClip({
    url,
    title,
    // "Vaswani, Ashish" → "Ashish Vaswani".
    authors: tags
      .filter(([key]) => key === "citation_author")
      .map(([, name]) => clean(name)!.replace(/^([^,]+),\s*([^,]+)$/, "$2 $1")),
    venue:
      one("citation_journal_title", "citation_conference_title", "citation_publisher", "og:site_name") ??
      new URL(url).host.replace(/^www\./, ""),
    date: one("citation_publication_date", "citation_date", "citation_online_date")?.replaceAll("/", "-"),
    abstract: meaningful(one("citation_abstract", "og:description", "description")),
    arxiv: one("citation_arxiv_id"),
    doi: one("citation_doi")?.replace(/^doi:/i, ""),
    pdf: pdf && new URL(pdf, url).toString(),
  });
}

/**
 * Semantic Scholar knows most papers by DOI or arXiv id: it fills in an abstract the source
 * didn't give, and an arXiv copy (and so a free PDF) of a journal or proceedings paper.
 * Best effort: its public API is rate limited, and the clip is fine without it.
 */
async function fillFromSemanticScholar(clip: Fetched) {
  const paper = clip.paper!;
  if (clip.excerpt && (paper.arxiv || paper.pdf)) return;
  const id = paper.doi ? `DOI:${paper.doi}` : paper.arxiv && `ARXIV:${paper.arxiv}`;
  const fields = "title,abstract,externalIds";
  const base = "https://api.semanticscholar.org/graph/v1/paper";
  const url = id
    ? `${base}/${encodeURIComponent(id)}?fields=${fields}`
    : `${base}/search/match?query=${encodeURIComponent(clip.title!)}&fields=${fields}`;
  try {
    let res = await fetch(url, { headers: API_HEADERS });
    // The shared public pool throttles bursts; one patient retry usually gets through.
    if (res.status === 429) res = await new Promise((r) => setTimeout(r, 3000)).then(() => fetch(url, { headers: API_HEADERS }));
    if (!res.ok) return;
    type Found = { title?: string; abstract?: string | null; externalIds?: { ArXiv?: string } };
    const body = (await res.json()) as Found & { data?: Found[] };
    const found = id ? body : body.data?.[0];
    // A title search can return a near miss; only an exact title is the same paper.
    if (!found || (!id && simplify(found.title ?? "") !== simplify(clip.title!))) return;
    clip.excerpt ??= clean(found.abstract ?? undefined);
    if (!paper.arxiv && found.externalIds?.ArXiv) {
      paper.arxiv = found.externalIds.ArXiv;
      paper.pdf ??= `https://arxiv.org/pdf/${paper.arxiv}`;
    }
  } catch {
    // Offline or rate limited; keep what the source gave.
  }
}

function simplify(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function paperClip(p: {
  url: string;
  title?: string;
  authors: string[];
  venue?: string;
  /** YYYY, YYYY-MM or YYYY-MM-DD. */
  date?: string;
  abstract?: string;
  arxiv?: string;
  doi?: string;
  pdf?: string;
}): Fetched {
  if (!p.title) throw new Error("no title found");
  const year = Number(p.date?.slice(0, 4)) || undefined;
  return {
    kind: "paper",
    url: p.url,
    title: p.title,
    author: p.authors.length > 2 ? `${p.authors[0]} et al.` : p.authors.join(" and ") || undefined,
    source: p.venue ?? "Paper",
    // Some sites' descriptions are just the author list and venue, not an abstract.
    excerpt: p.authors.slice(0, 2).every((a) => p.abstract?.includes(a)) && p.authors.length > 1 ? undefined : p.abstract,
    published: /^\d{4}-\d{2}-\d{2}$/.test(p.date ?? "") ? p.date : undefined,
    paper: { authors: p.authors, year, arxiv: p.arxiv, doi: p.doi, pdf: p.pdf },
  };
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

/** A post as FxTwitter (api.fxtwitter.com, open source) describes it. */
type FxPost = {
  url: string;
  text: string;
  created_timestamp: number;
  likes?: number;
  author: { name: string; screen_name: string; avatar_url?: string };
  media?: { all?: { type: string; url: string; thumbnail_url?: string }[] };
  quote?: FxPost;
  replying_to_status?: string | null;
  /** An X Article: a long post with a title. */
  article?: { title?: string; preview_text?: string };
};

async function fetchFx(id: string): Promise<FxPost | null> {
  const res = await fetch(`https://api.fxtwitter.com/status/${id}`, { headers: API_HEADERS, signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const data = (await res.json()) as { code?: number; tweet?: FxPost };
  return data.code === 200 && data.tweet?.author ? data.tweet : null;
}

/** Photos as they are; videos and GIFs by their poster frame. */
const fxMedia = (post: FxPost) => (post.media?.all ?? []).map((m) => (m.type === "photo" ? m.url : (m.thumbnail_url ?? m.url))).filter(Boolean);

function fxText(post: FxPost): string {
  const text = decodeEntities(post.text ?? "").trim();
  if (text || !post.article?.title) return text;
  return [post.article.title, post.article.preview_text].filter(Boolean).join("\n\n");
}

const fxQuoted = (post: FxPost): QuotedPost => ({
  name: post.author.name,
  handle: post.author.screen_name,
  text: fxText(post),
  url: `https://x.com/${post.author.screen_name}/status/${post.url.split("/").pop()}`,
  ...(fxMedia(post).length ? { media: fxMedia(post) } : {}),
});

/** A post that is an X Article: FxTwitter says so, or the post is nothing but the article's link. */
const isArticle = (post: FxPost) => Boolean(post.article?.title) || /^https?:\/\/(?:x|twitter)\.com\/i\/article\/\d+\/?$/.test(post.text.trim());

/**
 * An X Article, clipped as an article: its title, first lines and cover. The text itself is read
 * when it's opened (lib/x-article.ts). When X won't give the article, vxtwitter's summary of it
 * (title, preview and picture) will do; failing that, it's kept as a post.
 */
async function fetchXArticleClip(post: FxPost, id: string): Promise<Fetched | null> {
  const url = `https://x.com/${post.author.screen_name}/status/${id}`;
  const base = {
    kind: "article" as const,
    url,
    author: post.author.name,
    source: "X",
    published: new Date(post.created_timestamp * 1000).toISOString().slice(0, 10),
    xArticle: { handle: post.author.screen_name, avatar: post.author.avatar_url },
  };
  const article = await fetchXArticle(id).catch(() => null);
  if (article) {
    return {
      ...base,
      title: article.title,
      excerpt: article.preview || undefined,
      image: article.cover,
      published: article.published ?? base.published,
      minutes: articleMinutes(article),
    };
  }
  const res = await fetch(`https://api.vxtwitter.com/${post.author.screen_name}/status/${id}`, { headers: API_HEADERS, signal: AbortSignal.timeout(8000) }).catch(() => null);
  const vx = res?.ok ? ((await res.json()) as { article?: { title?: string; preview_text?: string; image?: string } }).article : undefined;
  const title = vx?.title ?? post.article?.title;
  if (!title) return null;
  return { ...base, title, excerpt: vx?.preview_text ?? post.article?.preview_text, image: vx?.image };
}

async function fetchTweet(url: string): Promise<Fetched> {
  const id = tweetId(url)!;
  // FxTwitter has the full text of long posts (X's embed endpoint cuts them off), quotes and replies.
  const post = await fetchFx(id).catch(() => null);
  if (post && isArticle(post)) {
    const article = await fetchXArticleClip(post, id);
    if (article) return article;
  }
  if (post) {
    const parent = post.replying_to_status ? await fetchFx(post.replying_to_status).catch(() => null) : null;
    return {
      kind: "tweet",
      url: `https://x.com/${post.author.screen_name}/status/${id}`,
      author: post.author.name,
      source: "X",
      published: new Date(post.created_timestamp * 1000).toISOString().slice(0, 10),
      tweet: {
        name: post.author.name,
        handle: post.author.screen_name,
        avatar: post.author.avatar_url,
        text: fxText(post),
        media: fxMedia(post),
        likes: post.likes,
        ...(post.quote?.author ? { quote: fxQuoted(post.quote) } : {}),
        ...(parent ? { replyTo: fxQuoted(parent) } : {}),
      },
    };
  }
  return fetchTweetSyndicated(url);
}

/** X's own embed data: the fallback when FxTwitter can't describe a post. Long posts come back cut off. */
async function fetchTweetSyndicated(url: string): Promise<Fetched> {
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
async function fetchTweetOembed(url: string): Promise<Fetched> {
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

async function fetchPage(url: string, kind?: ClipKind): Promise<Fetched> {
  if (/^https?:\/\/(www\.)?openreview\.net\//.test(url)) {
    throw new Error("OpenReview shows scripts a browser check instead of the paper; clip its arXiv link instead");
  }
  const res = await fetch(url, { headers: HEADERS, redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const html = await res.text();
  if (!kind || kind === "paper") {
    const paper = citationPaper(html, res.url || url);
    if (paper) return paper;
  }
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

/** Every <meta> tag as [property, name or itemprop; content], in page order. Values may be unquoted. */
function metaTags(html: string): [string, string][] {
  const tags: [string, string][] = [];
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = Object.fromEntries(
      [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)].map((m) => [
        m[1].toLowerCase(),
        m[2] ?? m[3] ?? m[4].replace(/\/$/, ""),
      ]),
    );
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase();
    if (key && attrs.content) tags.push([key, attrs.content]);
  }
  return tags;
}

/** <meta> tags keyed by property, name or itemprop. The first value for a key wins. */
function readMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [key, content] of metaTags(html)) if (!(key in meta)) meta[key] = content;
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
