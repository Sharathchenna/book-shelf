import { Readability } from "@mozilla/readability";
import type { ArticleBlock, ArticleEmbed, ArticleMath, XArticle, XArticlePost } from "@/lib/x-article-types";

/**
 * A clipped article or newsletter issue, read whole for the reader, in the browser: the site
 * fetches the page (/api/books/clips/source, which only relays it), Mozilla's Readability finds
 * its article here, and its HTML becomes the same blocks an X Article is made of
 * (lib/x-article-types.ts), so one converter makes an ebook of either (x-article-epub.ts).
 * Headings, paragraphs with their bold, italic, code and links, lists, quotes, code (with its
 * language), figures, tables, rules and equations are kept, and the page's videos, audio, players
 * (YouTube, Vimeo, Spotify…) and posts on X, to play and show in place. Parsing here, not on the
 * server, keeps it off the Worker's CPU limit.
 */

/** The page as the site relays it, and what the clipping already knows. */
export type WebPage = {
  html: string;
  /** Where the page ended up, after redirects. */
  url: string;
  clip: { id: string; url: string; title?: string; author?: string; source: string; excerpt?: string; image?: string; published?: string };
  /** The post as its feed carried it (lib/feeds.ts), read instead when the page has too little on it. */
  fallback?: string;
};

/** Fewer words than this is a page whose article never reached the HTML (a script shell). */
const MIN_WORDS = 80;

export function webArticle(page: WebPage): XArticle | { error: string } {
  const read = readPage(page, MIN_WORDS);
  // Too little on the page (a short post, or one its scripts fill in): the feed's own copy, short or not.
  if ("error" in read && page.fallback) {
    const fed = readPage({ ...page, html: `<html><head><title>${(page.clip.title ?? "").replace(/</g, "&lt;")}</title></head><body><article>${page.fallback}</article></body></html>` }, FEED_MIN_WORDS);
    if (!("error" in fed)) return fed;
  }
  return read;
}

/** A post from a feed is read however short it is, as long as it says something. */
const FEED_MIN_WORDS = 8;

function readPage({ html, url: base, clip }: WebPage, minWords: number): XArticle | { error: string } {
  // Parsed inert: nothing in it runs or loads. The <base> makes its links and pictures absolute.
  const doc = new DOMParser().parseFromString(`<base href="${base.replace(/"/g, "&quot;")}">${html}`, "text/html");
  revealStreamed(doc);
  const kept = setAside(doc, html, base);
  const parsed = new Readability(doc, { keepClasses: false }).parse();
  if (!parsed?.content) return { error: "Couldn't find an article on that page." };

  const body = new DOMParser().parseFromString(`<base href="${base.replace(/"/g, "&quot;")}"><body>${parsed.content}</body>`, "text/html").body;
  const blocks = toBlocks(body, base, kept);
  const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
  if (words < minWords) return { error: "The page has too little text to read: its article may load with scripts, or sit behind a login." };

  const title = clip.title ?? parsed.title?.trim() ?? clip.url;
  // The title Readability leaves at the top would repeat the book's own title page.
  if (blocks[0] && /^header/.test(blocks[0].type) && same(blocks[0].text, title)) blocks.shift();
  const pictured = blocks.some((b) => b.media?.length);
  return {
    id: clip.id,
    url: clip.url,
    title,
    preview: clip.excerpt ?? parsed.excerpt ?? "",
    ...(clip.image && !pictured && !BLANK.test(clip.image) ? { cover: clip.image } : {}),
    ...(clip.published ? { published: clip.published.slice(0, 10) } : {}),
    author: { name: clip.author ?? parsed.byline?.trim() ?? clip.source },
    site: parsed.siteName?.trim() || clip.source,
    blocks,
  };
}

/** Placeholder pictures some sites (WordPress) give as their share image. */
const BLANK = /\/blank\.(jpe?g|png|gif)\b/i;

const same = (a: string, b: string) => a.toLowerCase().replace(/\W+/g, "") === b.toLowerCase().replace(/\W+/g, "");

// ---- HTML to blocks ----------------------------------------------------------------------------

const HEADINGS: Record<string, string> = { H1: "header-one", H2: "header-two", H3: "header-three", H4: "header-three", H5: "header-three", H6: "header-three" };
const STYLES: Record<string, string> = { B: "Bold", STRONG: "Bold", I: "Italic", EM: "Italic", CITE: "Italic", CODE: "Code", KBD: "Code", S: "Strikethrough", DEL: "Strikethrough" };
/** Elements whose text is never read. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "BUTTON", "FORM", "IFRAME", "OBJECT", "VIDEO", "AUDIO", "TEMPLATE", "INPUT", "SELECT"]);

/** An address on the web, made absolute against the page's; nothing for any other kind (data:, blob:, javascript:). */
function absolute(href: string | null | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    const url = new URL(href, base);
    return /^https?:$/.test(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A picture's own address. An image resizer's (Next.js's /_next/image, Vercel's /_vercel/image)
 * names the original in its `url`, which the original's CDN serves without the site's bot
 * checks, at full size.
 */
function pictureUrl(href: string | null | undefined, base: string): string | undefined {
  const src = absolute(href, base);
  if (!src) return undefined;
  const url = new URL(src);
  const original = /\/_(next|vercel)\/image\/?$/.test(url.pathname) ? url.searchParams.get("url") : null;
  return absolute(original, base) || src;
}

function toBlocks(root: Element, base: string, kept: Kept): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  const abs = (href: string | null) => absolute(href, base);
  const picture = (href: string | null) => pictureUrl(href, base);
  const inline = (nodes: Node[]) => inlineRun(nodes, abs, kept);

  const walk = (el: Element, depth = 0) => {
    // Loose text and inline elements between blocks (pages set as text with <br><br> between
    // paragraphs, like Paul Graham's) make paragraphs together, broken at a blank line.
    let run: Node[] = [];
    const flush = () => {
      if (run.length) push("unstyled", inline(run));
      run = [];
    };
    /** A footnote's mark ("[5]") left between two paragraphs ends the one before, where it was. */
    const mark = (child: Element): boolean => {
      const prev = out.at(-1);
      const foot = inline([child]);
      if (!/^\[?\d{1,3}\]?$|^\*{1,3}$/.test(foot.text) || prev?.type !== "unstyled" || !prev.text) return false;
      const at = prev.text.length + 1;
      prev.text += ` ${foot.text}`;
      prev.styles.push(...foot.styles.map((r) => ({ ...r, offset: r.offset + at })));
      prev.links.push(...foot.links.map((r) => ({ ...r, offset: r.offset + at })));
      return true;
    };
    /** Readability can leave a footnote's opening bracket as a paragraph of its own: it starts the next. */
    const reopen = () => {
      if (run.length || out.at(-1)?.type !== "unstyled" || out.at(-1)?.text !== "[") return;
      out.pop();
      run.push(el.ownerDocument.createTextNode("["));
    };
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        if (node.textContent?.trim()) reopen();
        run.push(node);
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const tag = child.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (tag === "BR") {
        const last = run.findLast((n) => n.nodeType !== 3 || n.textContent?.trim());
        if (last && last.nodeType === 1 && (last as Element).tagName.toUpperCase() === "BR") {
          run.splice(run.lastIndexOf(last));
          flush();
        } else run.push(child);
        continue;
      }
      if (INLINE.has(tag) && !child.querySelector(BLOCKS)) {
        reopen();
        if (!run.some((n) => n.textContent?.trim()) && mark(child)) continue;
        run.push(child);
        continue;
      }
      flush();
      if (HEADINGS[tag]) push(HEADINGS[tag], inline([child]));
      else if (tag === "P") {
        // A paragraph that only holds a picture is a figure.
        const imgs = Array.from(child.querySelectorAll("img"));
        if (imgs.length && !child.textContent?.trim()) figure(imgs, undefined);
        else push("unstyled", inline([child]));
      } else if (tag === "UL" || tag === "OL") list(child, depth);
      else if (tag === "BLOCKQUOTE") {
        const inner = Array.from(child.children);
        const paras = inner.length && inner.every((c) => c.tagName.toUpperCase() === "P") ? inner : [child];
        for (const p of paras) push("blockquote", inline([p]));
      } else if (tag === "PRE") {
        const lang = child.getAttribute(LANG) ?? undefined;
        out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], code: child.textContent ?? "", ...(lang ? { lang } : {}) });
      } else if (tag === "HR") out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], divider: true });
      else if (tag === "FIGURE" || tag === "PICTURE") {
        const caption = child.querySelector("figcaption");
        const imgs = Array.from(child.querySelectorAll("img"));
        if (BLOCK_MARK.test(child.textContent ?? "") || (!imgs.length && child.querySelector(BLOCKS))) {
          // A video or player set aside, or code or a table, over its caption.
          caption?.remove();
          walk(child, depth);
          figure([], caption);
        } else figure(imgs, caption);
      }
      else if (tag === "IMG") figure([child], null);
      else if (tag === "TABLE") table(child);
      else if (child.querySelector(BLOCKS)) walk(child, depth);
      else if (child.textContent?.trim()) push("unstyled", inline([child]));
    }
    flush();
  };

  /** A run as a block of `type`; where it holds what was set aside (a video, a player, a post), that goes between its halves. */
  const push = (type: string, run: Inline, depth = 0) => {
    const at = new RegExp(BLOCK_MARK.source).exec(run.text);
    if (at) {
      push(type, cut(run, 0, at.index), depth);
      const block = kept.blocks[Number(at[1])];
      if (block) out.push(block);
      push(type, cut(run, at.index + at[0].length, run.text.length), depth);
      return;
    }
    if (run.text.trim()) out.push({ type, depth, ...run });
  };

  const list = (el: Element, depth: number) => {
    const type = el.tagName.toUpperCase() === "OL" ? "ordered-list-item" : "unordered-list-item";
    for (const li of Array.from(el.children)) {
      if (li.tagName.toUpperCase() !== "LI") continue;
      const nested = Array.from(li.children).filter((c) => /^(UL|OL)$/i.test(c.tagName));
      const own = Array.from(li.childNodes).filter((n) => !nested.includes(n as Element));
      push(type, inline(own), Math.min(depth, 4));
      for (const sub of nested) list(sub, depth + 1);
    }
  };

  const figure = (imgs: Element[], caption: Element | null | undefined) => {
    const media = imgs.flatMap((img) => {
      // Lazy-loaded pictures keep the real one in data-src (or a srcset), with a placeholder in src.
      const raw = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-lazy-src"), firstSrcset(img.getAttribute("srcset"))].find(
        (v) => v && !v.startsWith("data:"),
      );
      const src = picture(raw ?? null);
      const width = Number(img.getAttribute("width")) || undefined;
      // Tracking pixels and spacers.
      if (!src || (width !== undefined && width < 8)) return [];
      return [{ src, ...(width ? { width } : {}) }];
    });
    if (media.length) out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], media });
    if (caption?.textContent?.trim()) {
      const run = inline([caption]);
      run.styles.push({ offset: 0, length: run.text.length, style: "Italic" });
      push("unstyled", run);
    }
  };

  /** A table's rows, its own (not a table's inside it), each cell with its bold, italic and links; a row of headings is a head. */
  const table = (el: Element) => {
    const rows = Array.from(el.querySelectorAll("tr"))
      .filter((tr) => tr.closest("table") === el)
      .map((tr) => {
        const cells = Array.from(tr.children).filter((c) => /^T[HD]$/i.test(c.tagName));
        const head = tr.parentElement?.tagName.toUpperCase() === "THEAD" || (cells.length > 0 && cells.every((c) => c.tagName.toUpperCase() === "TH"));
        return { head, cells: cells.map((c) => inline([c])) };
      })
      .filter((row) => row.cells.some((c) => c.text));
    if (rows.length) out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], table: rows.slice(0, 200) });
  };

  walk(root);
  return out;
}

/** Elements that start a block of their own, and those that run on inside a paragraph. */
const BLOCKS = "p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, figure, img, table, hr, div, section";
const INLINE = new Set(["A", "ABBR", "B", "BIG", "CITE", "CODE", "DEL", "DFN", "EM", "FONT", "I", "INS", "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "TIME", "TT", "U", "VAR"]);

const firstSrcset = (srcset: string | null) => srcset?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;

type Inline = Pick<ArticleBlock, "text" | "styles" | "links" | "maths">;

/** Nodes' text with its bold, italic, code, links and equations, as offsets into the text (UTF-16, like X's). */
function inlineRun(nodes: Node[], abs: (href: string | null) => string | undefined, kept: Kept): Inline {
  let text = "";
  const styles: ArticleBlock["styles"] = [];
  const links: ArticleBlock["links"] = [];
  const maths: ArticleMath[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      // Runs of white space read as one space, as a browser shows them.
      const run = (node.textContent ?? "").replace(/\s+/g, " ").replace(/^ /, text.endsWith(" ") || text.endsWith("\n") || !text ? "" : " ");
      // An equation set aside reads as its TeX (or its words), and is drawn from its MathML.
      run.split(new RegExp(`(${MATH_MARK.source})`)).forEach((piece, i) => {
        if (i % 3 === 2) return;
        const math = i % 3 === 1 ? kept.maths[Number(/\d+/.exec(piece)?.[0])] : undefined;
        if (!math) {
          if (i % 3 === 0) text += piece;
          return;
        }
        const { alt, ...rest } = math;
        maths.push({ offset: text.length, length: alt.length, ...rest });
        text += alt;
      });
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag) || tag === "IMG") return;
    if (tag === "BR") {
      text = text.replace(/ $/, "") + "\n";
      return;
    }
    const start = text.length;
    for (const child of Array.from(el.childNodes)) visit(child);
    const length = text.length - start;
    if (!length) return;
    if (STYLES[tag]) styles.push({ offset: start, length, style: STYLES[tag] });
    const href = tag === "A" ? abs(el.getAttribute("href")) : undefined;
    if (href) links.push({ offset: start, length, url: href });
  };
  for (const node of nodes) visit(node);
  return cut({ text, styles, links, ...(maths.length ? { maths } : {}) }, 0, text.length);
}

/** Part of a run, from `from` to `to`, trimmed, with its ranges moved to match and those outside it dropped. */
function cut(run: Inline, from: number, to: number): Inline {
  const raw = run.text.slice(from, to);
  const start = from + raw.length - raw.trimStart().length;
  const text = raw.trim();
  const end = start + text.length;
  const fit = <T extends { offset: number; length: number }>(r: T): T | null => {
    const a = Math.max(start, r.offset);
    const b = Math.min(end, r.offset + r.length);
    return b > a ? { ...r, offset: a - start, length: b - a } : null;
  };
  const keep = <T extends { offset: number; length: number }>(rs: T[]) => rs.map(fit).filter((r): r is T => r !== null);
  const maths = keep(run.maths ?? []);
  return { text, styles: keep(run.styles), links: keep(run.links), ...(maths.length ? { maths } : {}) };
}

// ---- what Readability would lose, set aside first ----------------------------------------------

/**
 * What was taken out of the page before Readability read it, each left as a mark in the text:
 * equations (kept as MathML or TeX, which Readability would flatten into stray letters) and the
 * blocks it would drop or empty (videos, audio, players from other sites, posts on X).
 */
type Kept = { maths: (Omit<ArticleMath, "offset" | "length"> & { alt: string })[]; blocks: ArticleBlock[] };

/** The marks left in the text: an equation's, inside a paragraph; a block's, in a paragraph of its own. */
const MATH_MARK = /\uE000(\d+)\uE001/;
const BLOCK_MARK = /\uE002(\d+)\uE003/;
/** A code block's language, noted on its <pre> (Readability drops classes, where most pages name it). */
const LANG = "data-shelf-lang";
const MATHML = "http://www.w3.org/1998/Math/MathML";

function setAside(doc: Document, html: string, base: string): Kept {
  const kept: Kept = { maths: [], blocks: [] };
  const abs = (href: string | null | undefined) => absolute(href, base);
  const atomic = (extra: Partial<ArticleBlock>): ArticleBlock => ({ type: "atomic", text: "", depth: 0, styles: [], links: [], ...extra });
  /** `el` replaced by a paragraph holding the block's mark. */
  const asBlock = (el: Element, block: ArticleBlock) => {
    const p = doc.createElement("p");
    p.textContent = `\uE002${kept.blocks.push(block) - 1}\uE003`;
    el.replaceWith(p);
  };
  const asMath = (el: Element, math: Kept["maths"][number]) => el.replaceWith(doc.createTextNode(`\uE000${kept.maths.push(math) - 1}\uE001`));

  // ---- code: its language, and its lines as text ----
  for (const pre of Array.from(doc.querySelectorAll("pre"))) {
    const lang = codeLanguage(pre);
    if (lang) pre.setAttribute(LANG, lang);
    pre.textContent = codeText(pre);
  }

  // ---- equations the page drew (KaTeX, MathJax, Wikipedia's, MathML) ----
  const equation = (holder: Element, math: Element | null, display: boolean, tex?: string | null) => {
    if (!math && !tex) return;
    const source = tex?.trim() || math?.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() || unwrapTex(math?.getAttribute("alttext"));
    const alt = (source || math?.textContent || "").replace(/\s+/g, " ").trim() || "[equation]";
    asMath(holder, { display, alt, ...(math ? { mathml: mathml(math, display) } : { tex: source }) });
  };
  for (const el of Array.from(doc.querySelectorAll(".katex-display"))) equation(el, el.querySelector("math"), true);
  for (const el of Array.from(doc.querySelectorAll(".katex"))) if (el.isConnected) equation(el, el.querySelector("math"), false);
  for (const el of Array.from(doc.querySelectorAll("mjx-container"))) equation(el, el.querySelector("math"), el.getAttribute("display") === "true");
  for (const el of Array.from(doc.querySelectorAll(".mwe-math-element"))) {
    const math = el.querySelector("math");
    equation(el, math, math?.getAttribute("display") === "block");
  }
  for (const el of Array.from(doc.querySelectorAll('script[type^="math/tex"]'))) equation(el, null, /mode=display/.test(el.getAttribute("type") ?? ""), el.textContent);
  for (const math of Array.from(doc.getElementsByTagNameNS(MATHML, "math"))) if (math.isConnected) equation(math, math, math.getAttribute("display") === "block");

  // ---- equations left as TeX for a script to draw: \( \), \[ \], $$ $$, and $ $ where the page says so ----
  if (/mathjax|katex/i.test(html)) {
    const dollars = /inlineMath[^\]]*\[\s*["']\$["']|left:\s*["']\$["']/.test(html);
    const tex = new RegExp(
      String.raw`\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)` + (dollars ? String.raw`|(?<![\\$\w])\$(?=[^\s$])((?:\\\$|[^$\n])+?)(?<=[^\s\\])\$(?![\w$])` : ""),
      "g",
    );
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("pre, code, script, style, textarea, noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const texts: Text[] = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\$|\\[[(]/.test(n.textContent ?? "")) texts.push(n as Text);
    for (const node of texts) {
      const value = node.textContent ?? "";
      let last = 0;
      const parts: Node[] = [];
      for (const m of value.matchAll(tex)) {
        const source = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? "").trim();
        if (!source) continue;
        parts.push(doc.createTextNode(value.slice(last, m.index)));
        const display = m[4] === undefined && m[3] === undefined;
        parts.push(doc.createTextNode(`\uE000${kept.maths.push({ display, tex: source, alt: source.replace(/\s+/g, " ") }) - 1}\uE001`));
        last = m.index + m[0].length;
      }
      if (!parts.length) continue;
      parts.push(doc.createTextNode(value.slice(last)));
      node.replaceWith(...parts);
    }
  }

  // ---- posts on X: the page has their text and a link, X's script draws the card ----
  for (const quote of Array.from(doc.querySelectorAll("blockquote.twitter-tweet, blockquote.twitter-video"))) {
    const link = Array.from(quote.querySelectorAll("a[href]")).reverse().find((a) => /\/status(es)?\/\d+/.test(a.getAttribute("href") ?? ""));
    const id = /\/status(?:es)?\/(\d+)/.exec(link?.getAttribute("href") ?? "")?.[1];
    if (!id) continue;
    const by = /—\s*([^\n(]+?)\s*\(@(\w+)\)/.exec(quote.textContent ?? "");
    const text = quote.querySelector("p")?.textContent?.replace(/\s*(pic\.twitter\.com|https?:\/\/t\.co)\/\S+/g, "").trim();
    asBlock(quote, atomic({ post: { url: `https://x.com/${by?.[2] ?? "i"}/status/${id}`, ...(by ? { name: by[1], handle: by[2] } : {}), ...(text ? { text } : {}) } }));
  }
  // Substack's.
  for (const card of Array.from(doc.querySelectorAll("div.tweet[data-attrs]"))) {
    const data = json(card.getAttribute("data-attrs")) as { url?: string; full_text?: string; username?: string; name?: string } | null;
    const id = /\/status(?:es)?\/(\d+)/.exec(data?.url ?? "")?.[1];
    if (!data || !id) continue;
    asBlock(card, atomic({ post: { url: `https://x.com/${data.username ?? "i"}/status/${id}`, name: data.name, handle: data.username, text: data.full_text } }));
  }

  // ---- players from other sites ----
  const embed = (el: Element, src: string | undefined, title: string | null | undefined, width?: number, height?: number) => {
    const found = src && player(src, width, height);
    if (!found) return false;
    if ("post" in found) asBlock(el, atomic({ post: found.post }));
    else asBlock(el, atomic({ embed: { ...found, ...(title?.trim() ? { title: title.trim() } : {}) } }));
    return true;
  };
  for (const frame of Array.from(doc.querySelectorAll("iframe"))) {
    const src = abs(frame.getAttribute("src") || frame.getAttribute("data-src") || frame.getAttribute("data-lazy-src"));
    embed(frame, src, frame.getAttribute("title"), Number(frame.getAttribute("width")) || undefined, Number(frame.getAttribute("height")) || undefined);
  }
  // Players drawn by a script from a placeholder (lite-youtube-embed and the like).
  for (const el of Array.from(doc.querySelectorAll("lite-youtube[videoid], [data-youtube-id]"))) {
    const id = el.getAttribute("videoid") ?? el.getAttribute("data-youtube-id");
    const start = el.getAttribute("params")?.match(/(?:^|&)start=(\d+)/)?.[1];
    embed(el, `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ""}`, el.getAttribute("title") ?? el.getAttribute("playlabel"));
  }
  for (const el of Array.from(doc.querySelectorAll("lite-vimeo[videoid]"))) embed(el, `https://player.vimeo.com/video/${el.getAttribute("videoid")}`, el.getAttribute("title"));

  // ---- videos and audio, played from where the page has them ----
  for (const el of Array.from(doc.querySelectorAll("video"))) {
    const sources = Array.from(el.querySelectorAll("source"))
      .sort((a, b) => Number(/mp4/.test(b.getAttribute("type") ?? "")) - Number(/mp4/.test(a.getAttribute("type") ?? "")))
      .map((s) => s.getAttribute("src") ?? s.getAttribute("data-src"));
    const src = [el.getAttribute("src"), el.getAttribute("data-src"), ...sources].map(abs).find(Boolean);
    const poster = pictureUrl(el.getAttribute("poster") ?? el.getAttribute("data-poster"), base);
    if (!src) {
      // A video only a script could play (a stream, a blob): its still, if it has one.
      if (poster) asBlock(el, atomic({ media: [{ src: poster }] }));
      continue;
    }
    const width = Number(el.getAttribute("width")) || undefined;
    const height = Number(el.getAttribute("height")) || undefined;
    // Playing by itself, silent or round and round: a GIF in all but name.
    const loop = el.hasAttribute("autoplay") && (el.hasAttribute("muted") || el.hasAttribute("loop"));
    asBlock(el, atomic({ video: { src, ...(poster ? { poster } : {}), ...(width && height ? { width, height } : {}), ...(loop ? { loop } : {}) } }));
  }
  for (const el of Array.from(doc.querySelectorAll("audio"))) {
    const src = [el.getAttribute("src"), ...Array.from(el.querySelectorAll("source")).map((s) => s.getAttribute("src"))].map(abs).find(Boolean);
    if (src) asBlock(el, atomic({ audio: { src } }));
  }
  return kept;
}

/**
 * A player the ebook can show, from the address of the page's frame or of a video's own page:
 * the player's address, set to play there, and where it lives on its own site; or a post on X.
 */
function player(src: string, width?: number, height?: number): Omit<ArticleEmbed, "title"> | { post: XArticlePost } | null {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  const aspect = width && height && width > 0 && height > 0 ? Math.round((width / height) * 1000) / 1000 : undefined;
  const youtube = /^(?:m\.)?youtube(?:-nocookie)?\.com$/.test(host) || host === "youtu.be";
  if (youtube) {
    const list = url.searchParams.get("list");
    const id =
      host === "youtu.be" ? url.pathname.slice(1, 12) : (/^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(url.pathname)?.[1] ?? url.searchParams.get("v"));
    if (id && /^[\w-]{11}$/.test(id)) {
      const t = url.searchParams.get("start") ?? url.searchParams.get("t");
      const start = t ? seconds(t) : 0;
      return {
        kind: "youtube",
        player: `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`,
        url: `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}` : ""}`,
        aspect: url.pathname.startsWith("/shorts/") ? 9 / 16 : aspect,
      };
    }
    if (list) return { kind: "youtube", player: `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(list)}`, url: `https://www.youtube.com/playlist?list=${encodeURIComponent(list)}`, aspect };
    return null;
  }
  if (host === "player.vimeo.com" || host === "vimeo.com") {
    const id = /\/(?:video\/)?(\d+)/.exec(url.pathname)?.[1];
    const hash = url.searchParams.get("h");
    return id ? { kind: "vimeo", player: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`, url: `https://vimeo.com/${id}`, aspect } : null;
  }
  if (host === "loom.com") {
    const id = /^\/(?:embed|share)\/([0-9a-f]+)/.exec(url.pathname)?.[1];
    return id ? { kind: "loom", player: `https://www.loom.com/embed/${id}`, url: `https://www.loom.com/share/${id}`, aspect } : null;
  }
  if (host === "open.spotify.com") {
    const m = /^\/(?:embed\/)?(episode|show|track|album|playlist)\/(\w+)/.exec(url.pathname);
    return m ? { kind: "spotify", player: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, url: `https://open.spotify.com/${m[1]}/${m[2]}`, height: /episode|track/.test(m[1]) ? 152 : 352 } : null;
  }
  if (host === "embed.podcasts.apple.com") {
    return { kind: "apple", player: url.href, url: `https://podcasts.apple.com${url.pathname}${url.search}`, height: url.searchParams.has("i") ? 175 : 450 };
  }
  if (host === "w.soundcloud.com" && url.pathname.startsWith("/player")) {
    const track = url.searchParams.get("url");
    return { kind: "soundcloud", player: url.href, url: track ?? url.href, height: height && height > 60 && height < 600 ? height : 166 };
  }
  if (host === "platform.twitter.com" || host === "platform.x.com") {
    const id = url.searchParams.get("id");
    return id && /^\d+$/.test(id) ? { post: { url: `https://x.com/i/status/${id}` } } : null;
  }
  // Charts, notebooks and sandboxes: a script's work, so a link to it rather than a frame.
  if (/(^|\.)(datawrapper\.dwcdn\.net|flo\.uri\.sh|flourish\.studio|codepen\.io|observablehq\.com|codesandbox\.io|jsfiddle\.net|stackblitz\.com|hf\.space)$/.test(host)) {
    return { kind: "interactive", player: url.href, url: url.href.replace(/(codepen\.io\/[^/]+)\/embed\//, "$1/pen/") };
  }
  return null;
}

/** "90", "1m30s" or "1h2m3s", as seconds. */
function seconds(t: string): number {
  if (/^\d+$/.test(t)) return Number(t);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

const json = (s: string | null) => {
  try {
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
};

/** An equation as MathML for the ebook: in its own namespace, without scripts, links, styles or the HTML some carry beside it. */
function mathml(math: Element, display: boolean): string {
  const copy = math.cloneNode(true) as Element;
  for (const el of Array.from(copy.querySelectorAll("*"))) if (el.namespaceURI !== MATHML || el.localName === "annotation-xml") el.remove();
  for (const el of [copy, ...Array.from(copy.querySelectorAll("*"))]) {
    for (const attr of Array.from(el.attributes)) if (/^on|href$|^(style|class|id|alttext)$/i.test(attr.name)) el.removeAttribute(attr.name);
  }
  copy.setAttribute("display", display ? "block" : "inline");
  return new XMLSerializer().serializeToString(copy);
}

/** Wikipedia's alt text wraps the TeX in `{\displaystyle …}`. */
const unwrapTex = (alt: string | null | undefined) => alt?.replace(/^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/, "$1").trim();

/** Languages pages name that aren't one: plain text. */
const PLAIN = new Set(["text", "plain", "plaintext", "txt", "none", "nohighlight", "no-highlight", "output"]);

/** The language a code block is in, as the page names it: on the <pre>, its <code>, or the box around it. */
function codeLanguage(pre: Element): string | undefined {
  for (const el of [pre, pre.querySelector("code"), pre.parentElement, pre.parentElement?.parentElement]) {
    if (!el) continue;
    const named = el.getAttribute("data-language") ?? el.getAttribute("data-lang");
    const lang = named ?? Array.from(el.classList).map((c) => /^(?:language|lang|highlight-source|highlight)-([\w+#.-]+)$/i.exec(c)?.[1]).find(Boolean);
    if (lang) return PLAIN.has(lang.toLowerCase()) ? undefined : lang.toLowerCase();
  }
  return undefined;
}

/**
 * A code block's text, line by line: without the line numbers or copy buttons some pages set in
 * it; and where a highlighter put each line in an element of its own with no line break between,
 * a break after each.
 */
function codeText(pre: Element): string {
  const copy = pre.cloneNode(true) as Element;
  copy.querySelectorAll("button, .lineno, .linenos, .line-number, .line-numbers-rows, .gutter, [data-line-number]").forEach((el) => el.remove());
  const text = copy.textContent ?? "";
  if (text.includes("\n") || !copy.querySelector("div, p, br")) return text.replace(/\n+$/, "");
  let out = "";
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      out += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = (node as Element).tagName.toUpperCase();
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const line = tag === "DIV" || tag === "P";
    if (line && out && !out.endsWith("\n")) out += "\n";
    node.childNodes.forEach(visit);
    if (line && !out.endsWith("\n")) out += "\n";
  };
  visit(copy);
  return out.replace(/\n+$/, "");
}

/**
 * React streaming (Next.js App Router, Suspense) sends a skeleton first and the real content
 * later in `<div hidden id="S:6">`, which a script moves into place. Readability drops hidden
 * nodes, so the article went with it. This does the script's work (from Gloss's importer).
 */
function revealStreamed(doc: Document) {
  for (const seg of Array.from(doc.querySelectorAll("div[hidden]"))) {
    const m = /^S:(\d+)$/.exec(seg.id);
    if (!m) continue;
    const boundary = doc.getElementById(`B:${m[1]}`);
    const slot = boundary ?? doc.getElementById(`P:${m[1]}`);
    if (!slot?.parentNode) {
      seg.removeAttribute("hidden");
      continue;
    }
    if (boundary) {
      // The fallback runs from the template to the comment that closes its boundary.
      let depth = 0;
      for (let n = boundary.nextSibling; n; ) {
        const next = n.nextSibling;
        if (n.nodeType === 8) {
          const data = (n as Comment).data;
          if (data === "/$") {
            if (depth === 0) break;
            depth--;
          } else if (data === "$" || data === "$?" || data === "$!") depth++;
        }
        n.parentNode?.removeChild(n);
        n = next;
      }
    }
    while (seg.firstChild) slot.parentNode.insertBefore(seg.firstChild, slot);
    slot.parentNode.removeChild(slot);
    seg.parentNode?.removeChild(seg);
  }
}
