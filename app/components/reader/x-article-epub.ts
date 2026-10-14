/**
 * Turns a clipped article (an X Article, or any other, read whole by lib/web-article.ts) into an
 * EPUB, so it reads in the EPUB reader like a book: themes, fonts, highlights and notes, and read
 * aloud. Its blocks (lib/x-article-types.ts) map onto plain XHTML: a chapter per top-level
 * heading, the title, author and cover on the first page, and the pictures fetched through the
 * site (the reader's pages can't load them from other sites).
 */
import type { XArticle, XArticleBlock } from "@/lib/x-article-types";
import { webArticle, type WebPage } from "./web-article";

type Chapter = { file: string; title: string; html: string[]; headings: { id: string; label: string }[] };
type Image = { path: string; data: Blob; cover?: boolean };

const XHTML = "http://www.w3.org/1999/xhtml";
const MAX_IMAGES = 150;
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

  // ---- chapters: split at the top level of headings the article uses, when it uses several ----
  onProgress("Binding the book…");
  const top = ["header-one", "header-two"].find((t) => article.blocks.filter((b) => b.type === t).length >= 2);
  const first: Chapter = { file: "c0.xhtml", title: article.title, html: [], headings: [] };
  first.html.push(titlePage(article, pathOf));
  const chapters: Chapter[] = [first];
  let current = first;
  const blocks = article.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (top && block.type === top && block.text.trim()) {
      current = { file: `c${chapters.length}.xhtml`, title: block.text.trim(), html: [], headings: [] };
      chapters.push(current);
    }
    // Consecutive list items or lines of code make one list or one code block.
    if (/list-item$/.test(block.type)) {
      let end = i;
      while (end + 1 < blocks.length && /list-item$/.test(blocks[end + 1].type)) end++;
      current.html.push(list(blocks.slice(i, end + 1)));
      i = end;
      continue;
    }
    if (block.type === "code-block") {
      let end = i;
      while (end + 1 < blocks.length && blocks[end + 1].type === "code-block") end++;
      current.html.push(`<pre><code>${esc(blocks.slice(i, end + 1).map((b) => b.text).join("\n"))}</code></pre>`);
      i = end;
      continue;
    }
    current.html.push(blockHtml(block, current, pathOf));
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
  for (const chapter of chapters) {
    oebps.file(
      chapter.file,
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body class="xarticle">${chapter.html.join("\n")}</body></html>`,
    );
  }
  oebps.file("nav.xhtml", nav(chapters, article.title));
  oebps.file("content.opf", opf(article, chapters, images));
  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}

/** The title, the author and date, and the cover. */
function titlePage(article: XArticle, pathOf: Map<string, string>): string {
  const cover = article.cover && pathOf.get(article.cover);
  const date = article.published ? fullDate.format(new Date(`${article.published}T00:00:00Z`)) : "";
  return [
    `<header class="title-page">`,
    cover ? `<div class="cover"><img src="${cover}" alt=""/></div>` : "",
    `<h1>${esc(article.title)}</h1>`,
    article.author.handle
      ? `<p class="byline">${esc(article.author.name)} <a href="https://x.com/${esc(article.author.handle)}">@${esc(article.author.handle)}</a>${date ? ` · ${esc(date)}` : ""}</p>`
      : `<p class="byline">${esc([article.author.name, article.site !== article.author.name ? article.site : "", date].filter(Boolean).join(" · "))} <a href="${esc(article.url)}">↗</a></p>`,
    `</header>`,
  ].join("");
}

function blockHtml(block: XArticleBlock, chapter: Chapter, pathOf: Map<string, string>): string {
  switch (block.type) {
    case "header-one":
    case "header-two":
    case "header-three": {
      const level = { "header-one": 2, "header-two": 3, "header-three": 4 }[block.type];
      // Unique in the chapter: its place among the chapter's blocks.
      const id = `h${chapter.file.replace(/\D/g, "")}-${chapter.html.length}`;
      // The heading a chapter starts with is the chapter's own title; the others go in the contents under it.
      if (block.text.trim() && block.text.trim() !== chapter.title) chapter.headings.push({ id, label: block.text.trim() });
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
    default:
      return block.text.trim() ? `<p>${inline(block)}</p>` : "";
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

function nav(chapters: Chapter[], title: string): string {
  const items = chapters
    .map((c) => {
      const sub = c.headings.length ? `<ol>${c.headings.map((h) => `<li><a href="${c.file}#${h.id}">${esc(h.label)}</a></li>`).join("")}</ol>` : "";
      return `<li><a href="${c.file}">${esc(c.title)}</a>${sub}</li>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${items}</ol></nav></body></html>`;
}

function opf(article: XArticle, chapters: Chapter[], images: Image[]): string {
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
${chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"/>`).join("\n")}
${images.map((img, i) => `<item id="i${i}" href="${img.path}" media-type="${mime(img.path)}"${img.cover ? ' properties="cover-image"' : ""}/>`).join("\n")}
</manifest>
<spine>${chapters.map((_, i) => `<itemref idref="c${i}"/>`).join("")}</spine>
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

/** Just enough for the article's structure; the reader's theme, font and size settings apply on top (bookCss in foliate.ts). */
const STYLE = `
.xarticle .title-page { margin-bottom: 2em; }
.xarticle .cover { margin: 0 0 1.4em; }
.xarticle .cover img { width: 100%; height: auto; border-radius: .5em; }
.xarticle h1 { font-size: 1.7em; line-height: 1.2; margin: 0 0 .5em; }
.xarticle .byline { font-size: .9em; opacity: .75; }
.xarticle .byline a { text-decoration: none; }
.xarticle h2 { font-size: 1.35em; line-height: 1.3; margin: 1.4em 0 .6em; }
.xarticle h3 { font-size: 1.15em; margin: 1.3em 0 .5em; }
.xarticle h4 { font-size: 1em; margin: 1.1em 0 .4em; }
.xarticle figure { margin: 1.4em 0; text-align: center; break-inside: avoid; }
.xarticle img { max-width: 100%; height: auto; }
.xarticle blockquote { margin: 1.2em 0; padding-left: 1em; border-left: 3px solid currentColor; opacity: .9; }
.xarticle blockquote.post { border: 1px solid currentColor; border-radius: .6em; padding: .8em 1em; opacity: .85; }
.xarticle .post-by { font-size: .85em; margin-top: .4em; }
.xarticle pre { font-size: .8em; white-space: pre-wrap; padding: .8em 1em; border-radius: .5em; background: rgba(127,127,127,.12); }
.xarticle code { font-size: .9em; }
.xarticle ul, .xarticle ol { padding-left: 1.4em; }
.xarticle li { margin: .25em 0; }
.xarticle table { border-collapse: collapse; font-size: .85em; margin: 1.2em 0; width: 100%; }
.xarticle th, .xarticle td { border: 1px solid rgba(127,127,127,.35); padding: .3em .5em; text-align: left; vertical-align: top; }
.xarticle hr { border: 0; border-top: 1px solid currentColor; opacity: .3; margin: 2em 0; }
`;
