import { Readability } from "@mozilla/readability";
import type { ArticleBlock, XArticle } from "@/lib/x-article-types";

/**
 * A clipped article or newsletter issue, read whole for the reader, in the browser: the site
 * fetches the page (/api/books/clips/source, which only relays it), Mozilla's Readability finds
 * its article here, and its HTML becomes the same blocks an X Article is made of
 * (lib/x-article-types.ts), so one converter makes an ebook of either (x-article-epub.ts).
 * Headings, paragraphs with their bold, italic, code and links, lists, quotes, code, figures,
 * tables and rules are kept. Parsing here, not on the server, keeps it off the Worker's CPU limit.
 */

/** The page as the site relays it, and what the clipping already knows. */
export type WebPage = {
  html: string;
  /** Where the page ended up, after redirects. */
  url: string;
  clip: { id: string; url: string; title?: string; author?: string; source: string; excerpt?: string; image?: string; published?: string };
};

/** Fewer words than this is a page whose article never reached the HTML (a script shell). */
const MIN_WORDS = 80;

export function webArticle({ html, url: base, clip }: WebPage): XArticle | { error: string } {
  // Parsed inert: nothing in it runs or loads. The <base> makes its links and pictures absolute.
  const doc = new DOMParser().parseFromString(`<base href="${base.replace(/"/g, "&quot;")}">${html}`, "text/html");
  revealStreamed(doc);
  const parsed = new Readability(doc, { keepClasses: false }).parse();
  if (!parsed?.content) return { error: "Couldn't find an article on that page." };

  const body = new DOMParser().parseFromString(`<base href="${base.replace(/"/g, "&quot;")}"><body>${parsed.content}</body>`, "text/html").body;
  const blocks = toBlocks(body, base);
  const words = blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
  if (words < MIN_WORDS) return { error: "The page has too little text to read: its article may load with scripts, or sit behind a login." };

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

function toBlocks(root: Element, base: string): ArticleBlock[] {
  const out: ArticleBlock[] = [];
  const abs = (href: string | null) => {
    if (!href) return undefined;
    try {
      const url = new URL(href, base);
      return /^https?:$/.test(url.protocol) ? url.href : undefined;
    } catch {
      return undefined;
    }
  };

  const walk = (el: Element, depth = 0) => {
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType === 3) {
        // Loose text between blocks becomes its own paragraph.
        if (node.textContent?.trim()) push("unstyled", inline([node], abs));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const child = node as Element;
      const tag = child.tagName.toUpperCase();
      if (SKIP.has(tag)) continue;
      if (HEADINGS[tag]) push(HEADINGS[tag], inline([child], abs));
      else if (tag === "P") {
        // A paragraph that only holds a picture is a figure.
        const imgs = Array.from(child.querySelectorAll("img"));
        if (imgs.length && !child.textContent?.trim()) figure(imgs, undefined);
        else push("unstyled", inline([child], abs));
      } else if (tag === "UL" || tag === "OL") list(child, depth);
      else if (tag === "BLOCKQUOTE") {
        const inner = Array.from(child.children);
        const paras = inner.length && inner.every((c) => c.tagName.toUpperCase() === "P") ? inner : [child];
        for (const p of paras) push("blockquote", inline([p], abs));
      } else if (tag === "PRE") out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], code: child.textContent ?? "" });
      else if (tag === "HR") out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], divider: true });
      else if (tag === "FIGURE" || tag === "PICTURE") figure(Array.from(child.querySelectorAll("img")), child.querySelector("figcaption"));
      else if (tag === "IMG") figure([child], null);
      else if (tag === "TABLE") table(child);
      else if (child.querySelector("p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, figure, img, table, hr, div, section")) walk(child, depth);
      else if (child.textContent?.trim()) push("unstyled", inline([child], abs));
    }
  };

  const push = (type: string, run: Inline, depth = 0) => {
    if (run.text.trim()) out.push({ type, depth, ...run });
  };

  const list = (el: Element, depth: number) => {
    const type = el.tagName.toUpperCase() === "OL" ? "ordered-list-item" : "unordered-list-item";
    for (const li of Array.from(el.children)) {
      if (li.tagName.toUpperCase() !== "LI") continue;
      const nested = Array.from(li.children).filter((c) => /^(UL|OL)$/i.test(c.tagName));
      const own = Array.from(li.childNodes).filter((n) => !nested.includes(n as Element));
      push(type, inline(own, abs), Math.min(depth, 4));
      for (const sub of nested) list(sub, depth + 1);
    }
  };

  const figure = (imgs: Element[], caption: Element | null | undefined) => {
    const media = imgs.flatMap((img) => {
      // Lazy-loaded pictures keep the real one in data-src (or a srcset), with a placeholder in src.
      const raw = [img.getAttribute("src"), img.getAttribute("data-src"), img.getAttribute("data-lazy-src"), firstSrcset(img.getAttribute("srcset"))].find(
        (v) => v && !v.startsWith("data:"),
      );
      const src = abs(raw ?? null);
      const width = Number(img.getAttribute("width")) || undefined;
      // Tracking pixels and spacers.
      if (!src || (width !== undefined && width < 8)) return [];
      return [{ src, ...(width ? { width } : {}) }];
    });
    if (media.length) out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], media });
    if (caption?.textContent?.trim()) {
      const run = inline([caption], abs);
      run.styles.push({ offset: 0, length: run.text.length, style: "Italic" });
      push("unstyled", run);
    }
  };

  const table = (el: Element) => {
    const rows = Array.from(el.querySelectorAll("tr"))
      .map((tr) => Array.from(tr.children).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim()))
      .filter((row) => row.some(Boolean));
    if (rows.length) out.push({ type: "atomic", text: "", depth: 0, styles: [], links: [], table: rows.slice(0, 200) });
  };

  walk(root);
  return out;
}

const firstSrcset = (srcset: string | null) => srcset?.split(",")[0]?.trim().split(/\s+/)[0] ?? null;

type Inline = Pick<ArticleBlock, "text" | "styles" | "links">;

/** Nodes' text with its bold, italic, code and links, as offsets into the text (UTF-16, like X's). */
function inline(nodes: Node[], abs: (href: string | null) => string | undefined): Inline {
  let text = "";
  const styles: ArticleBlock["styles"] = [];
  const links: ArticleBlock["links"] = [];
  const visit = (node: Node) => {
    if (node.nodeType === 3) {
      // Runs of white space read as one space, as a browser shows them.
      text += (node.textContent ?? "").replace(/\s+/g, " ").replace(/^ /, text.endsWith(" ") || text.endsWith("\n") || !text ? "" : " ");
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
  // Trimmed, with every range moved to match.
  const lead = text.length - text.trimStart().length;
  const trimmed = text.trim();
  const fit = <T extends { offset: number; length: number }>(r: T): T | null => {
    const from = Math.max(0, r.offset - lead);
    const to = Math.min(trimmed.length, r.offset - lead + r.length);
    return to > from ? { ...r, offset: from, length: to - from } : null;
  };
  return {
    text: trimmed,
    styles: styles.map(fit).filter((r): r is (typeof styles)[number] => r !== null),
    links: links.map(fit).filter((r): r is (typeof links)[number] => r !== null),
  };
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
