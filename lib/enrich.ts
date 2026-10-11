import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, HAIKU, haikuEnabled } from "./ai/haiku";
import type { Clip, Enrichment } from "./types";

/**
 * What a clipping is about, worked out once when it's saved, so search can find it by meaning
 * rather than by the words it happens to use: the text of the page a post links to, and Claude
 * Haiku's one-line summary, topics, and a description of each image (charts and screenshots
 * included, with the text in them). Papers carry an abstract already and are left as they are.
 */

const PAGE_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; book-shelf-clipper/0.1; personal reading shelf)",
  Accept: "text/html,application/xhtml+xml",
};
/** How much of a linked page Claude reads, and how much is kept for search. */
const READ_CHARS = 6000;
const KEEP_CHARS = 1500;
const MAX_IMAGES = 4;

const SYSTEM = `You catalogue things a person saved while reading online (posts on X, articles, newsletter issues), so they can find them again months later by describing them loosely.

For the item given, write:
- summary: one plain sentence, under 30 words, saying what it is and what's interesting about it. Concrete: name the tool, claim, result or idea. No "This post…" opener, no hype.
- topics: 3 to 6 short lowercase topics someone might search for (e.g. "llm evals", "isometric rendering", "startup hiring").
- images: for each image, in order, one or two sentences on what it shows, including any text, numbers, chart axes or code in it. An empty list when there are no images.`;

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    topics: { type: "array", items: { type: "string" } },
    images: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "topics", "images"],
  additionalProperties: false,
};

/** Enrichment for a clipping, or undefined for papers. AI failures leave what could be done without it. */
export async function enrich(clip: Clip): Promise<Enrichment | undefined> {
  if (clip.kind === "paper") return undefined;
  const linkUrl = clip.tweet ? linkIn(clip) : clip.url;
  const page = linkUrl ? await readPage(linkUrl).catch(() => null) : null;
  const link = page && linkUrl ? { url: linkUrl, ...(page.title ? { title: page.title } : {}), text: page.text.slice(0, KEEP_CHARS) } : undefined;

  const described = haikuEnabled() ? await describe(clip, page).catch((error) => (console.error("Enrichment failed", clip.id, error), null)) : null;
  if (!described && !link) return undefined;
  return {
    summary: described?.summary ?? "",
    topics: described?.topics ?? [],
    ...(described?.images.length ? { images: described.images } : {}),
    // For an article the page is the clipping itself; only a post's link is worth keeping apart.
    ...(link && clip.tweet ? { link } : {}),
    at: new Date().toISOString(),
  };
}

/** The first link in a post (or the post it quotes) that leads off X. */
function linkIn(clip: Clip): string | undefined {
  const text = [clip.tweet?.text, clip.tweet?.quote?.text].filter(Boolean).join("\n");
  return text.match(/https?:\/\/[^\s)]+/g)?.find((url) => !/^https?:\/\/(?:[^/]*\.)?(?:x\.com|twitter\.com|t\.co)\//i.test(url));
}

/** A page's title and readable text: its <article> (or <main>, or body) without scripts, navigation and forms. */
async function readPage(url: string): Promise<{ title?: string; text: string } | null> {
  const res = await fetch(url, { headers: PAGE_HEADERS, redirect: "follow", signal: AbortSignal.timeout(8000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  const html = (await res.text()).slice(0, 2_000_000);
  const title = decode(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "",
  ).trim();
  const body =
    html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const blocks = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|aside|form|button|figure)[\s\S]*?<\/\1>/gi, " ")
    .match(/<(p|h[1-4]|li|blockquote|pre)[^>]*>[\s\S]*?<\/\1>/gi);
  const text = (blocks ?? [body])
    .map((block) => decode(block.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 1)
    .join("\n")
    .slice(0, READ_CHARS);
  return text.length > 80 || title ? { title: title || undefined, text } : null;
}

type Described = { summary: string; topics: string[]; images: string[] };

async function describe(clip: Clip, page: { title?: string; text: string } | null): Promise<Described | null> {
  const post = clip.tweet;
  const images = (post ? [...post.media, ...(post.quote?.media ?? [])] : []).slice(0, MAX_IMAGES);
  const lines = [
    `Kind: ${clip.kind === "tweet" ? "a post on X" : clip.kind}`,
    clip.title && `Title: ${clip.title}`,
    post ? `By: ${post.name} (@${post.handle})` : clip.author && `By: ${clip.author}`,
    clip.source !== "X" && `Source: ${clip.source}`,
    post && `Post:\n${post.text}`,
    post?.replyTo && `In reply to @${post.replyTo.handle}:\n${post.replyTo.text}`,
    post?.quote && `Quoting @${post.quote.handle}:\n${post.quote.text}`,
    !post && clip.excerpt && `Excerpt: ${clip.excerpt}`,
    page && `${post ? "The page it links to" : "The page"}${page.title ? ` ("${page.title}")` : ""}:\n${page.text}`,
    clip.note && `The reader's own note: ${clip.note}`,
    images.length && `${images.length} image${images.length > 1 ? "s" : ""} attached above.`,
  ].filter(Boolean);

  const ask = async (withImages: boolean) => {
    const content: Anthropic.ContentBlockParam[] = [
      ...(withImages ? images.map((url): Anthropic.ImageBlockParam => ({ type: "image", source: { type: "url", url } })) : []),
      { type: "text", text: lines.join("\n\n") },
    ];
    const message = await anthropic().messages.create(
      {
        model: HAIKU,
        max_tokens: 1500,
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content }],
      },
      { signal: AbortSignal.timeout(30_000) },
    );
    if (message.stop_reason === "refusal") return null;
    const text = message.content.find((block) => block.type === "text")?.text;
    return text ? (JSON.parse(text) as Described) : null;
  };

  // An image X won't serve shouldn't cost the rest: try again without them.
  const described = await ask(images.length > 0).catch((error) => (images.length ? ask(false) : Promise.reject(error)));
  if (!described) return null;
  return {
    summary: described.summary.trim().slice(0, 300),
    topics: [...new Set(described.topics.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 6),
    images: described.images.map((d) => d.trim()).filter(Boolean).slice(0, images.length),
  };
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
