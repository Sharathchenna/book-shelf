/**
 * Turns a clipped article (an X Article, or any other, read whole by lib/web-article.ts) into an
 * EPUB, so it opens in the reader with its highlights, notes, AI and reading aloud. It is made to
 * read like a page in Gloss rather than a book: one section the reader scrolls from top to bottom
 * (reader-view.tsx shows articles scrolled), headed by the site, the title, a standfirst and the
 * byline, with the pictures fetched through the site (the reader's pages can't load them from
 * other sites). Its blocks (lib/x-article-types.ts) map onto plain XHTML.
 */
import { articleMinutes, type XArticle, type XArticleBlock } from "@/lib/x-article-types";
import { webArticle, type WebPage } from "./web-article";

/** The page, and its headings for the contents: the top level the article uses, and those under it. */
type Page = { title: string; html: string[]; headings: { id: string; label: string; sub: boolean }[]; lede: boolean };
type Image = { path: string; data: Blob; cover?: boolean };

const XHTML = "http://www.w3.org/1999/xhtml";
const FILE = "article.xhtml";
const MAX_IMAGES = 150;
const HEADINGS = ["header-one", "header-two", "header-three"];
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

export async function buildArticleEpub(clipId: string, onProgress: (label: string) => void): Promise<Blob> {
  onProgress("Fetching the article…");
  const res = await fetch(`/api/books/clips/source?clipId=${encodeURIComponent(clipId)}`);
  const source = (await res.json().catch(() => ({}))) as (XArticle | WebPage) & { error?: string };
  if (!res.ok) throw new Error(source.error ?? "Couldn't fetch the article.");
  // A web page is read here; an X Article arrives as blocks.
  if ("html" in source) onProgress("Reading the page…");
  const article = "html" in source ? webArticle(source) : source;
  if ("error" in article) throw new Error(article.error);
  if (!article.blocks) throw new Error("Couldn't fetch the article.");

  // ---- pictures, fetched first so the pages can point at them ----
  const sources = [article.cover, ...article.blocks.flatMap((b) => (b.media ?? []).map((m) => m.src))].filter((s): s is string => Boolean(s));
  const wanted = [...new Set(sources)].slice(0, MAX_IMAGES);
  const images: Image[] = [];
  const pathOf = new Map<string, string>();
  let done = 0;
  await pool(wanted, 4, async (src) => {
    const res = await fetch(`/api/books/clips/asset?url=${encodeURIComponent(src)}`).catch(() => null);
    if (res?.ok) {
      const type = res.headers.get("content-type") ?? "image/jpeg";
      const ext = type.includes("png") ? "png" : type.includes("gif") ? "gif" : type.includes("webp") ? "webp" : "jpg";
      const path = `images/p${images.length + 1}.${ext}`;
      images.push({ path, data: await res.blob(), cover: src === article.cover });
      pathOf.set(src, path);
    }
    onProgress(`Fetching pictures ${++done} of ${wanted.length}…`);
  });

  // ---- the page ----
  onProgress("Setting the page…");
  // The contents list the top level of headings the article uses, with the next level under each.
  const top = HEADINGS.find((t) => article.blocks.some((b) => b.type === t && b.text.trim()));
  const page: Page = { title: article.title.trim(), html: [masthead(article, pathOf)], headings: [], lede: false };
  const blocks = article.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    // Consecutive list items or lines of code make one list or one code block.
    if (/list-item$/.test(block.type)) {
      let end = i;
      while (end + 1 < blocks.length && /list-item$/.test(blocks[end + 1].type)) end++;
      page.html.push(list(blocks.slice(i, end + 1)));
      i = end;
      continue;
    }
    if (block.type === "code-block") {
      let end = i;
      while (end + 1 < blocks.length && blocks[end + 1].type === "code-block") end++;
      page.html.push(`<pre><code>${esc(blocks.slice(i, end + 1).map((b) => b.text).join("\n"))}</code></pre>`);
      i = end;
      continue;
    }
    page.html.push(blockHtml(block, page, top, pathOf));
  }

  // ---- package ----
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
  );
  const oebps = zip.folder("OEBPS")!;
  oebps.file("style.css", STYLE);
  for (const image of images) oebps.file(image.path, image.data);
  oebps.file(
    FILE,
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(article.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body class="xarticle">${page.html.join("\n")}</body></html>`,
  );
  oebps.file("nav.xhtml", nav(page, article.title));
  oebps.file("content.opf", opf(article, images));
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}

/**
 * The head of the page, as Gloss sets it: the site, the title, a standfirst, then under a rule
 * who wrote it and when, how long it takes to read, and a link to the original; the cover last.
 */
function masthead(article: XArticle, pathOf: Map<string, string>): string {
  const cover = article.cover && pathOf.get(article.cover);
  const date = article.published ? fullDate.format(new Date(`${article.published}T00:00:00Z`)) : "";
  const kicker = article.author.handle ? "X" : article.site && article.site !== article.author.name ? article.site : "";
  // The preview is a standfirst when it is one: short, and not just the opening of the text.
  const preview = article.preview.trim();
  const opening = article.blocks.find((b) => b.type === "unstyled" && b.text.trim())?.text.trim() ?? "";
  const dek = preview && preview.length <= 320 && !opening.startsWith(preview.replace(/\s*(…|\.\.\.)$/, "")) ? preview : "";
  const who = article.author.handle ? `${article.author.name} <span class="handle">@${esc(article.author.handle)}</span>` : esc(article.author.name || article.site || "");
  const length = { short: 26, medium: 50, long: 90 };
  const size = article.title.length <= length.short ? "t1" : article.title.length <= length.medium ? "t2" : article.title.length <= length.long ? "t3" : "t4";
  return [
    `<header class="masthead">`,
    kicker ? `<p class="kicker"><span class="dot"></span>${esc(kicker)}</p>` : "",
    `<h1 class="${size}">${esc(article.title)}</h1>`,
    dek ? `<p class="dek">${esc(dek)}</p>` : "",
    `<div class="byline"><div class="who">`,
    `<p class="name">${who}${date ? `<span class="date">  ·  ${esc(date)}</span>` : ""}</p>`,
    `<p class="length">${articleMinutes(article)} min read</p>`,
    `</div>`,
    /^https?:\/\//i.test(article.url) ? `<a class="original" href="${esc(article.url)}">Original ↗</a>` : "",
    `</div>`,
    cover ? `<figure class="cover"><img src="${cover}" alt=""/></figure>` : "",
    `</header>`,
  ].join("");
}

function blockHtml(block: XArticleBlock, page: Page, top: string | undefined, pathOf: Map<string, string>): string {
  switch (block.type) {
    case "header-one":
    case "header-two":
    case "header-three": {
      const level = { "header-one": 2, "header-two": 3, "header-three": 4 }[block.type];
      // Unique on the page: its place among the page's blocks.
      const id = `h${page.html.length}`;
      const label = block.text.trim();
      // A heading repeating the title is left out of the contents, which start with the title.
      if (label && label !== page.title && top) {
        if (block.type === top) page.headings.push({ id, label, sub: false });
        else if (block.type === HEADINGS[HEADINGS.indexOf(top) + 1] && page.headings.length) page.headings.push({ id, label, sub: true });
      }
      return `<h${level} id="${id}">${inline(block)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote><p>${inline(block)}</p></blockquote>`;
    case "atomic":
      if (block.media?.length) {
        return block.media
          .map((m) => pathOf.get(m.src))
          .filter(Boolean)
          .map((path) => `<figure><img src="${path}" alt=""/></figure>`)
          .join("");
      }
      if (block.post) {
        const { post } = block;
        const by = post.handle ? `${esc(post.name ?? post.handle)} (@${esc(post.handle)})` : "A post on X";
        return `<blockquote class="post">${post.text ? `<p>${esc(post.text).replace(/\n/g, "<br/>")}</p>` : ""}<p class="post-by">— <a href="${esc(post.url)}">${by}</a></p></blockquote>`;
      }
      if (block.code !== undefined) return `<pre><code>${esc(block.code.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, ""))}</code></pre>`;
      if (block.divider) return `<hr/>`;
      if (block.table) {
        const [head, ...rows] = block.table;
        const row = (cells: string[], tag: string) => `<tr>${cells.map((c) => `<${tag}>${esc(c)}</${tag}>`).join("")}</tr>`;
        return `<table><thead>${row(head, "th")}</thead><tbody>${rows.map((r) => row(r, "td")).join("")}</tbody></table>`;
      }
      return "";
    default: {
      if (!block.text.trim()) return "";
      // The opening paragraph starts with a coloured capital, as in Gloss.
      // Not on an editor's note set in italics, which some articles open with.
      // (Its italics can come in pieces, around its links.)
      const italic = block.styles.filter((r) => r.style === "Italic").reduce((n, r) => n + r.length, 0) >= block.text.trim().length * 0.8;
      const lede = !page.lede && !italic && /^\p{L}/u.test(block.text.trim()) && block.text.trim().length > 60;
      if (lede) page.lede = true;
      return `<p${lede ? ' class="lede"' : ""}>${inline(block)}</p>`;
    }
  }
}

/** List items at their depths, nested. */
function list(items: XArticleBlock[]): string {
  let html = "";
  const open: string[] = [];
  for (const item of items) {
    const tag = item.type === "ordered-list-item" ? "ol" : "ul";
    const depth = Math.min(item.depth, 4);
    while (open.length > depth + 1) html += `</li></${open.pop()}>`;
    if (open.length === depth + 1 && open[depth] !== tag) html += `</li></${open.pop()}>`;
    if (open.length === depth + 1) html += "</li>";
    while (open.length < depth + 1) {
      open.push(tag);
      html += `<${tag}>`;
    }
    html += `<li>${inline(item)}`;
  }
  while (open.length) html += `</li></${open.pop()}>`;
  return html;
}

const TAGS: Record<string, string> = { Bold: "strong", Italic: "em", Strikethrough: "s", Code: "code" };

/** A block's text with its bold, italic and links: split wherever a style or link starts or ends. */
function inline(block: XArticleBlock): string {
  const { text } = block;
  const cuts = new Set([0, text.length]);
  for (const r of [...block.styles, ...block.links]) {
    cuts.add(Math.max(0, r.offset));
    cuts.add(Math.min(text.length, r.offset + r.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    let piece = esc(text.slice(from, to)).replace(/\n/g, "<br/>");
    const covers = (r: { offset: number; length: number }) => r.offset <= from && r.offset + r.length >= to;
    for (const style of block.styles.filter(covers)) {
      const tag = TAGS[style.style];
      if (tag) piece = `<${tag}>${piece}</${tag}>`;
    }
    const link = block.links.find(covers);
    if (link && /^https?:\/\//i.test(link.url)) piece = `<a href="${esc(link.url)}">${piece}</a>`;
    html += piece;
  }
  return html;
}

/** Escaped for XHTML, without the control characters XML doesn't allow. */
function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function nav(page: Page, title: string): string {
  const items: string[] = [];
  for (const h of page.headings) {
    const link = `<a href="${FILE}#${h.id}">${esc(h.label)}</a>`;
    if (h.sub && items.length) items[items.length - 1] = items[items.length - 1].replace(/(<\/ol>)?<\/li>$/, (_, ol) => `${ol ? "" : "<ol>"}<li>${link}</li></ol></li>`);
    else items.push(`<li>${link}</li>`);
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol><li><a href="${FILE}">${esc(title)}</a></li>${items.join("")}</ol></nav></body></html>`;
}

function opf(article: XArticle, images: Image[]): string {
  const mime = (path: string) => ({ jpg: "image/jpeg", gif: "image/gif", webp: "image/webp" })[path.split(".").pop()!] ?? "image/png";
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:article:${esc(article.id)}</dc:identifier>
<dc:title>${esc(article.title)}</dc:title>
<dc:creator id="a0">${esc(article.author.name)}</dc:creator>
<dc:language>en</dc:language>
<dc:source>${esc(article.url)}</dc:source>${article.published ? `\n<dc:date>${esc(article.published)}</dc:date>` : ""}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="page" href="${FILE}" media-type="application/xhtml+xml"/>
${images.map((img, i) => `<item id="i${i}" href="${img.path}" media-type="${mime(img.path)}"${img.cover ? ' properties="cover-image"' : ""}/>`).join("\n")}
</manifest>
<spine><itemref idref="page"/></spine>
</package>`;
}

async function pool<T>(items: T[], size: number, run: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) await run(items[next++]);
    }),
  );
}

/**
 * Gloss's reading page: its title sizes, byline, headings, quotes, lists, figures and the coloured
 * opening capital. The reader's theme, font, size and spacing settings apply on top (bookCss in
 * foliate.ts), which also sets --rubric, --muted and --rule for the theme.
 * No vh units: the page's frame is as tall as the article, so they would measure that, and grow
 * with it.
 */
const STYLE = `
.xarticle { --rubric-c: var(--rubric, #1e7a58); --muted-c: var(--muted, rgba(127,127,127,.95)); --rule-c: var(--rule, rgba(127,127,127,.25)); font-variant-numeric: oldstyle-nums proportional-nums; font-kerning: normal; }
.xarticle .masthead { margin: 0 0 3.2em; }
.xarticle .kicker { display: flex; align-items: center; gap: .5em; margin: 0 0 1.5em; font: 500 .68em/1.3 system-ui, -apple-system, sans-serif; color: var(--muted-c); text-align: start !important; }
.xarticle .kicker .dot { width: 6px; height: 6px; border-radius: 99px; background: var(--rubric-c); flex: none; }
.xarticle h1 { font-weight: 380; letter-spacing: -0.022em; margin: 0; text-wrap: balance; font-variation-settings: "opsz" 72; }
.xarticle h1.t1 { font-size: 2.9em; line-height: 1.02; }
.xarticle h1.t2 { font-size: 2.4em; line-height: 1.06; }
.xarticle h1.t3 { font-size: 1.95em; line-height: 1.1; }
.xarticle h1.t4 { font-size: 1.6em; line-height: 1.14; }
.xarticle .dek { margin: 1.1em 0 0; font-size: 1.05em; line-height: 1.55 !important; opacity: .8; text-align: start !important; hyphens: manual !important; text-wrap: pretty; }
.xarticle .byline { display: flex; align-items: center; gap: 1em; margin: 2em 0 0; padding: 1.2em 0 0; border-top: 1px solid var(--rule-c); font-family: system-ui, -apple-system, sans-serif !important; }
.xarticle .byline * { font-family: inherit !important; text-align: start !important; }
.xarticle .who { flex: 1; min-width: 0; }
.xarticle .byline p { margin: 0; line-height: 1.4 !important; }
.xarticle .name { font-size: .74em; font-weight: 500; }
.xarticle .name .handle, .xarticle .name .date { font-weight: 400; color: var(--muted-c); white-space: pre; }
.xarticle .length { margin-top: .3em !important; font-size: .66em; color: var(--muted-c); }
.xarticle .byline a.original { flex: none; padding: .55em 1em; border: 1px solid var(--rule-c); border-radius: 99px; font-size: .66em; font-weight: 500; text-decoration: none; color: inherit !important; opacity: .85; }
.xarticle .cover { margin: 2.2em 0 0; }
.xarticle .cover img { display: block; width: 100%; height: auto; border-radius: 8px; }
.xarticle p { margin: 0 0 .95em; text-wrap: pretty; }
.xarticle p.lede::first-letter { float: left; font-size: 3.45em; line-height: .84; padding: .07em .06em 0 0; color: var(--rubric-c); font-weight: 400; }
@supports (initial-letter: 2) or (-webkit-initial-letter: 2) {
  .xarticle p.lede::first-letter { float: none; font-size: inherit; line-height: inherit; padding: 0; -webkit-initial-letter: 2; initial-letter: 2; margin-right: .12em; }
}
.xarticle h2 { font-size: 1.32em; line-height: 1.25; font-weight: 500; letter-spacing: -0.01em; margin: 2em 0 .7em; }
.xarticle h3 { font-size: 1.08em; line-height: 1.3; font-weight: 600; margin: 1.6em 0 .5em; }
.xarticle h4 { font-size: 1em; line-height: 1.3; font-weight: 600; margin: 1.4em 0 .4em; }
.xarticle figure { margin: 1.6em 0 1.5em; text-align: center; }
.xarticle figure img { display: block; max-width: 100%; height: auto; max-height: 640px; margin: 0 auto; border-radius: 6px; }
.xarticle img { max-width: 100%; height: auto; }
.xarticle blockquote { margin: 1.2em 0; padding-left: 1.1em; border-left: 2px solid var(--rule-c); font-style: italic; opacity: .85; }
.xarticle blockquote.post { font-style: normal; border: 1px solid var(--rule-c); border-radius: 10px; padding: .9em 1.1em; }
.xarticle .post-by { font-size: .82em; margin: .4em 0 0; }
.xarticle pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; font-size: .74em; line-height: 1.6; white-space: pre-wrap; padding: 1em 1.2em; border-radius: 8px; background: rgba(127,127,127,.1); }
.xarticle pre *, .xarticle code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; }
.xarticle code { font-size: .82em; padding: .1em .3em; border-radius: 4px; background: rgba(127,127,127,.1); }
.xarticle pre code { padding: 0; background: none; font-size: 1em; }
.xarticle ul, .xarticle ol { padding-left: 1.3em; margin: 0 0 .95em; }
.xarticle li { margin: 0 0 .4em; }
.xarticle li::marker { color: var(--muted-c); }
.xarticle table { border-collapse: collapse; font-family: system-ui, -apple-system, sans-serif; font-size: .74em; margin: 1.4em 0; width: 100%; }
.xarticle th, .xarticle td { border-bottom: 1px solid var(--rule-c); padding: .45em .6em; text-align: left; vertical-align: top; font-family: inherit !important; }
.xarticle th { font-weight: 600; }
.xarticle hr { border: 0; text-align: center; margin: 2.2em 0; }
.xarticle hr::after { content: "· · ·"; letter-spacing: .5em; color: var(--muted-c); }
.xarticle a { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: .2em; text-decoration-color: var(--rule-c); }
`;
