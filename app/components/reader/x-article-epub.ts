/**
 * Turns a clipped article (an X Article, or any other, read whole by lib/web-article.ts) into an
 * EPUB, so it opens in the reader with its highlights, notes, AI and reading aloud. It is made to
 * read like a page in Gloss rather than a book: one section the reader scrolls from top to bottom
 * (reader-view.tsx shows articles scrolled), headed by the site, the title, a standfirst and the
 * byline, with the pictures fetched through the site (the reader's pages can't load them from
 * other sites). Its blocks (lib/x-article-types.ts) map onto plain XHTML.
 */
import { articleMinutes, type ArticleEmbed, type ArticleVideo, type XArticle, type XArticleBlock, type XArticlePost } from "@/lib/x-article-types";
import { webArticle, type WebPage } from "./web-article";

/** The page, and its headings for the contents: the top level the article uses, and those under it. */
type Page = { title: string; html: string[]; headings: { id: string; label: string; sub: boolean }[]; lede: boolean; highlight: Highlighter };
/** Code set in colour, by its language or (failing that) a confident guess, with the language's name if it was named; null when there's no code. */
type Highlighter = ((code: string, lang?: string) => { html: string; name?: string }) | null;
/** Text with its styles, links and equations: a block's, or a table cell's. */
type Run = Pick<XArticleBlock, "text" | "styles" | "links" | "maths">;
type Image = { path: string; data: Blob; cover?: boolean };

const XHTML = "http://www.w3.org/1999/xhtml";
const FILE = "article.xhtml";
const MAX_IMAGES = 150;
const HEADINGS = ["header-one", "header-two", "header-three"];
const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

/**
 * A transcript's script (lib/media.ts): a paragraph's time plays the video (YouTube's player, by
 * its messages) or the episode's audio from there, and the paragraph being said is marked as it
 * plays. In CDATA, as the page is XHTML; the web reader leaves scripts out, so there it's text.
 */
const TRANSCRIPT_SCRIPT = `<script type="text/javascript">//<![CDATA[
(function () {
  var frame = document.querySelector('iframe[src*="youtube"]');
  var audio = document.querySelector('audio');
  var cues = Array.prototype.slice.call(document.querySelectorAll('p.cue'));
  function send(func, args) { if (frame && frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'command', func: func, args: args || [] }), '*'); }
  function seek(t) {
    if (audio) { audio.currentTime = t; audio.play(); }
    else if (frame) { send('seekTo', [t, true]); send('playVideo'); }
  }
  function mark(t) {
    var now = null;
    for (var i = 0; i < cues.length; i++) { if (parseFloat(cues[i].getAttribute('data-t')) <= t + 0.5) now = cues[i]; else break; }
    for (var j = 0; j < cues.length; j++) { if (cues[j] === now) cues[j].classList.add('now'); else cues[j].classList.remove('now'); }
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button.ts') : null;
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    seek(parseFloat(b.getAttribute('data-t')));
  }, true);
  if (audio) audio.addEventListener('timeupdate', function () { mark(audio.currentTime); });
  if (frame) {
    var listen = function () { if (frame.contentWindow) frame.contentWindow.postMessage(JSON.stringify({ event: 'listening', id: 'shelf', channel: 'widget' }), '*'); };
    frame.addEventListener('load', listen);
    setTimeout(listen, 1500);
    window.addEventListener('message', function (e) {
      try { var d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; if (d && d.info && typeof d.info.currentTime === 'number') mark(d.info.currentTime); } catch (err) {}
    });
  }
})();
//]]></script>`;

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

  // ---- posts on X the page only had the words of: who, when, and their pictures and videos ----
  const posts = article.blocks.filter((b) => b.post && !b.post.date);
  if (posts.length) onProgress("Fetching the posts it quotes…");
  await pool(posts.slice(0, 40), 4, async (b) => {
    const id = /\/status\/(\d+)/.exec(b.post!.url)?.[1];
    const res = id ? await fetch(`/api/books/clips/post?id=${id}`).catch(() => null) : null;
    const post = res?.ok ? ((await res.json().catch(() => null)) as XArticlePost | null) : null;
    if (post?.handle) b.post = { ...post, text: post.text ?? b.post!.text };
  });

  // ---- equations and code, set by their libraries, loaded only for an article that has them ----
  const runs: Run[] = article.blocks.flatMap((b) => [b, ...(b.table ?? []).flatMap((row) => row.cells)]);
  if (runs.some((r) => r.maths?.some((m) => !m.mathml && m.tex))) {
    const { default: temml } = await import("temml");
    for (const math of runs.flatMap((r) => r.maths ?? [])) {
      if (math.mathml || !math.tex) continue;
      try {
        const made = new DOMParser().parseFromString(temml.renderToString(math.tex, { displayMode: math.display, throwOnError: true }), "text/html").querySelector("math");
        if (made) math.mathml = new XMLSerializer().serializeToString(made);
      } catch {
        // Left as its TeX, in code type.
      }
    }
  }
  const highlight = article.blocks.some((b) => b.code !== undefined || b.type === "code-block") ? await highlighter() : null;

  // ---- pictures, fetched first so the pages can point at them ----
  const stills = article.blocks.flatMap((b) => [...(b.media ?? []), ...(b.post?.media ?? []), ...(b.video?.poster ? [{ src: b.video.poster }] : [])].map((m) => m.src));
  const sources = [article.cover, ...stills].filter((s): s is string => Boolean(s));
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
  const page: Page = { title: article.title.trim(), html: [masthead(article, pathOf)], headings: [], lede: false, highlight };
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
      page.html.push(codeHtml(blocks.slice(i, end + 1).map((b) => b.text).join("\n"), undefined, highlight));
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
  // A transcript's times play the video or episode from there, and the paragraph playing is marked.
  const body = page.html.join("\n") + (blocks.some((b) => b.cue !== undefined) ? TRANSCRIPT_SCRIPT : "");
  oebps.file(
    FILE,
    `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(article.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body class="xarticle">${body}</body></html>`,
  );
  oebps.file("nav.xhtml", nav(page, article.title));
  oebps.file("content.opf", opf(article, images, body));
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
  if (block.cue !== undefined) {
    const t = Math.max(0, Math.floor(block.cue));
    return `<p class="cue" id="t${t}" data-t="${t}"><button class="ts" type="button" data-t="${t}">${esc(block.cueLabel ?? "")}</button> ${inline(block)}</p>`;
  }
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
      if (block.video) return `<figure class="video">${videoHtml(block.video, pathOf)}</figure>`;
      if (block.audio) return `<figure class="audio"><audio src="${esc(block.audio.src)}" controls="controls" preload="metadata"><a href="${esc(block.audio.src)}">Listen ↗</a></audio></figure>`;
      if (block.embed) return embedHtml(block.embed);
      if (block.post) return postHtml(block.post, pathOf);
      if (block.code !== undefined) return codeHtml(block.code.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, ""), block.lang, page.highlight);
      if (block.divider) return `<hr/>`;
      if (block.table) {
        // Heading rows at the top make the table's head; any further down are headings among the rows.
        const lead = block.table.findIndex((r) => !r.head);
        const split = lead === -1 ? block.table.length : lead;
        const row = (r: (typeof block.table)[number]) => `<tr>${r.cells.map((c) => (r.head ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join("")}</tr>`;
        const head = block.table.slice(0, split).map(row).join("");
        return `<div class="table"><table>${head ? `<thead>${head}</thead>` : ""}<tbody>${block.table.slice(split).map(row).join("")}</tbody></table></div>`;
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

/** A block's text with its bold, italic, links and equations: split wherever one starts or ends. */
function inline(block: Run): string {
  const { text } = block;
  const maths = block.maths ?? [];
  const cuts = new Set([0, text.length]);
  for (const r of [...block.styles, ...block.links, ...maths]) {
    cuts.add(Math.max(0, r.offset));
    cuts.add(Math.min(text.length, r.offset + r.length));
  }
  const points = [...cuts].sort((a, b) => a - b);
  let html = "";
  for (let i = 0; i < points.length - 1; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    const covers = (r: { offset: number; length: number }) => r.offset <= from && r.offset + r.length >= to;
    // An equation is drawn whole, where it starts; its TeX stands in if it couldn't be made.
    const math = maths.find(covers);
    if (math) {
      if (from === math.offset) html += math.mathml ?? `<code class="tex">${esc(text.slice(math.offset, math.offset + math.length))}</code>`;
      continue;
    }
    let piece = esc(text.slice(from, to)).replace(/\n/g, "<br/>");
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

/** highlight.js with its common languages, and a guess only when it's a confident one. */
async function highlighter(): Promise<Highlighter> {
  const { default: hljs } = await import("highlight.js/lib/common");
  return (code, lang) => {
    try {
      const known = lang ? hljs.getLanguage(lang) : undefined;
      if (lang && known) return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, name: known.name };
      if (!lang && code.length < 20_000) {
        const guess = hljs.highlightAuto(code);
        if (guess.relevance >= 10) return { html: guess.value };
      }
    } catch {
      // Plain, below.
    }
    return { html: esc(code) };
  };
}

/** A code block: set in colour, its language named over it (one the highlighter knows), scrolled sideways rather than wrapped. */
function codeHtml(code: string, lang: string | undefined, highlight: Highlighter): string {
  const { html, name } = highlight ? highlight(code, lang) : { html: esc(code), name: undefined };
  return `<pre${name ? ` data-lang="${esc(name)}"` : ""}><code>${html}</code></pre>`;
}

/** A video, played from the page's site: its still until it plays, or playing by itself, silent and looping, as a GIF would. */
function videoHtml(video: ArticleVideo, pathOf: Map<string, string>): string {
  const poster = video.poster && pathOf.get(video.poster);
  const shape = video.width && video.height ? ` style="aspect-ratio: ${video.width} / ${video.height}"` : "";
  const flags = video.loop ? ` autoplay="autoplay" muted="muted" loop="loop"` : "";
  return `<video src="${esc(video.src)}" controls="controls" preload="metadata" playsinline="playsinline"${flags}${poster ? ` poster="${poster}"` : ""}${shape}><a href="${esc(video.src)}">Play the video ↗</a></video>`;
}

const PLAYERS: Record<ArticleEmbed["kind"], string> = {
  youtube: "YouTube", vimeo: "Vimeo", loom: "Loom", spotify: "Spotify", apple: "Apple Podcasts", soundcloud: "SoundCloud", interactive: "",
};

/**
 * Another site's player where the page had it, with a line under it to its page there (for when
 * there's no connection, or to watch it on its own). An interactive chart or sandbox is a link.
 */
function embedHtml(embed: ArticleEmbed): string {
  const name = PLAYERS[embed.kind];
  if (embed.kind === "interactive") {
    const host = new URL(embed.url).hostname.replace(/^www\./, "");
    return `<p class="interactive"><a href="${esc(embed.url)}"><span class="what">Interactive</span> ${esc(embed.title ?? host)} ↗</a></p>`;
  }
  const shape = embed.height ? `height: ${embed.height}px` : `aspect-ratio: ${embed.aspect ?? 16 / 9}`;
  const frame = `<iframe src="${esc(embed.player)}" title="${esc(embed.title ?? name)}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write" allowfullscreen="allowfullscreen" referrerpolicy="strict-origin-when-cross-origin" loading="lazy"></iframe>`;
  return `<figure class="embed ${embed.kind}"><div class="frame" style="${shape}">${frame}</div><figcaption><a href="${esc(embed.url)}">${embed.title ? `${esc(embed.title)} · ` : ""}${name} ↗</a></figcaption></figure>`;
}

const shortDate = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** A post on X as a card: who and when, what it says, its pictures and videos, and a link to it. */
function postHtml(post: XArticlePost, pathOf: Map<string, string>): string {
  const date = post.date ? shortDate.format(new Date(`${post.date}T00:00:00Z`)) : "";
  const head = post.handle
    ? `<p class="post-head"><span class="post-name">${esc(post.name ?? post.handle)}</span> <span class="post-meta">@${esc(post.handle)}${date ? ` · ${esc(date)}` : ""}</span></p>`
    : "";
  const media = (post.media ?? []).flatMap((m) => {
    const still = pathOf.get(m.src);
    if (m.video) return [videoHtml({ src: m.video, ...(m.src ? { poster: m.src } : {}), ...(m.width && m.height ? { width: m.width, height: m.height } : {}), ...(m.loop ? { loop: true } : {}) }, pathOf)];
    return still ? [`<img src="${still}" alt=""/>`] : [];
  });
  return [
    `<blockquote class="post">`,
    head,
    post.text ? `<p>${esc(post.text).replace(/\n/g, "<br/>")}</p>` : "",
    media.length ? `<div class="post-media${media.length > 1 ? " grid" : ""}">${media.join("")}</div>` : "",
    `<p class="post-by"><a href="${esc(post.url)}">${post.handle ? "View on X" : "A post on X"} ↗</a></p>`,
    `</blockquote>`,
  ].join("");
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

function opf(article: XArticle, images: Image[], page: string): string {
  // What the page holds that readers may want warning of: equations, and what plays from the web.
  const properties = [/<math\b/.test(page) && "mathml", /<(video|audio|iframe)\b/.test(page) && "remote-resources", /<script\b/.test(page) && "scripted"].filter(Boolean).join(" ");
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
<item id="page" href="${FILE}" media-type="application/xhtml+xml"${properties ? ` properties="${properties}"` : ""}/>
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
.xarticle blockquote.post { font-style: normal; opacity: 1; border: 1px solid var(--rule-c); border-radius: 12px; padding: 1em 1.15em; margin: 1.6em 0; }
.xarticle blockquote.post p { margin: 0 0 .6em; }
.xarticle .post-head, .xarticle .post-by { font-family: system-ui, -apple-system, sans-serif !important; text-align: start !important; }
.xarticle .post-head * { font-family: inherit !important; }
.xarticle .post-head { font-size: .78em; line-height: 1.35 !important; }
.xarticle .post-name { font-weight: 600; }
.xarticle .post-meta { color: var(--muted-c); }
.xarticle .post-media { display: grid; gap: 4px; margin: .8em 0 .6em; border-radius: 10px; overflow: hidden; }
.xarticle .post-media.grid { grid-template-columns: 1fr 1fr; }
.xarticle .post-media img, .xarticle .post-media video { display: block; width: 100%; height: 100%; max-height: 520px; object-fit: cover; border-radius: 0; margin: 0; }
.xarticle .post-by { font-size: .72em; margin: .2em 0 0 !important; }
.xarticle .post-by a { color: var(--muted-c) !important; text-decoration: none; }
.xarticle figure.video video { display: block; width: 100%; height: auto; max-height: 640px; border-radius: 8px; background: rgba(127,127,127,.12); }
.xarticle figure.audio audio { display: block; width: 100%; }
/* A transcript (lib/media.ts): each paragraph's time in the margin's small type, the one being said marked. */
.xarticle p.cue { border-radius: 6px; transition: background .3s; }
.xarticle p.cue.now { background: rgba(255, 216, 77, .2); }
.xarticle p.cue button.ts { font: 600 .68em/1 system-ui, -apple-system, sans-serif !important; color: var(--rubric, #1e7a58) !important; background: none !important; border: 0; padding: .2em .55em .2em 0; margin: 0; cursor: pointer; font-variant-numeric: tabular-nums; vertical-align: .1em; }
.xarticle figure.embed .frame { width: 100%; border-radius: 10px; overflow: hidden; background: rgba(127,127,127,.12); }
.xarticle figure.embed iframe { display: block; width: 100%; height: 100%; border: 0; }
.xarticle figure.embed figcaption { margin-top: .55em; font: .66em/1.4 system-ui, -apple-system, sans-serif; text-align: start; }
.xarticle figure.embed figcaption a, .xarticle .interactive a { color: var(--muted-c) !important; text-decoration: none; }
.xarticle .interactive a { display: block; padding: .85em 1.1em; border: 1px solid var(--rule-c); border-radius: 10px; font: .78em/1.4 system-ui, -apple-system, sans-serif; color: inherit !important; }
.xarticle .interactive .what { color: var(--rubric-c); font-weight: 600; margin-right: .4em; }
.xarticle math[display="block"] { display: block math; margin: 1em 0; overflow-x: auto; overflow-y: hidden; }
.xarticle math { font-size: 1.05em; }
.xarticle code.tex { white-space: pre-wrap; }
.xarticle pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; font-size: .74em; line-height: 1.6; white-space: pre !important; overflow-x: auto; tab-size: 4; text-align: start !important; hyphens: none !important; padding: 1em 1.2em; border-radius: 8px; background: rgba(127,127,127,.1); }
.xarticle pre[data-lang]::before { content: attr(data-lang); display: block; margin: -.2em 0 .6em; font: 600 .78em/1 system-ui, -apple-system, sans-serif; letter-spacing: .02em; color: var(--muted-c); }
.xarticle pre *, .xarticle code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important; }
.xarticle code { font-size: .82em; padding: .1em .3em; border-radius: 4px; background: rgba(127,127,127,.1); }
.xarticle pre code { padding: 0; background: none; font-size: 1em; white-space: inherit !important; }
.xarticle .hljs-keyword, .xarticle .hljs-built_in, .xarticle .hljs-meta, .xarticle .hljs-selector-tag, .xarticle .hljs-doctag { color: color-mix(in srgb, #b4235a 70%, currentColor); }
.xarticle .hljs-string, .xarticle .hljs-regexp, .xarticle .hljs-addition, .xarticle .hljs-meta .hljs-string { color: color-mix(in srgb, #2f8a3e 70%, currentColor); }
.xarticle .hljs-number, .xarticle .hljs-literal, .xarticle .hljs-symbol, .xarticle .hljs-variable.language_ { color: color-mix(in srgb, #c46a10 70%, currentColor); }
.xarticle .hljs-title, .xarticle .hljs-title.function_, .xarticle .hljs-section, .xarticle .hljs-selector-id, .xarticle .hljs-selector-class { color: color-mix(in srgb, #2b6cc4 70%, currentColor); }
.xarticle .hljs-type, .xarticle .hljs-title.class_, .xarticle .hljs-attr, .xarticle .hljs-attribute, .xarticle .hljs-property, .xarticle .hljs-name { color: color-mix(in srgb, #8a4fc2 70%, currentColor); }
.xarticle .hljs-comment, .xarticle .hljs-quote, .xarticle .hljs-deletion { color: var(--muted-c); font-style: italic; }
.xarticle .hljs-emphasis { font-style: italic; }
.xarticle .hljs-strong { font-weight: 600; }
.xarticle ul, .xarticle ol { padding-left: 1.3em; margin: 0 0 .95em; }
.xarticle li { margin: 0 0 .4em; }
.xarticle li::marker { color: var(--muted-c); }
.xarticle div.table { overflow-x: auto; margin: 1.4em 0; }
.xarticle table { border-collapse: collapse; font-family: system-ui, -apple-system, sans-serif; font-size: .74em; margin: 0; min-width: 100%; }
.xarticle th, .xarticle td { border-bottom: 1px solid var(--rule-c); padding: .45em .6em; text-align: left !important; vertical-align: top; font-family: inherit !important; min-width: 6em; max-width: 26em; hyphens: none !important; }
.xarticle th code, .xarticle td code { font-size: .92em; }
.xarticle th { font-weight: 600; }
.xarticle hr { border: 0; text-align: center; margin: 2.2em 0; }
.xarticle hr::after { content: "· · ·"; letter-spacing: .5em; color: var(--muted-c); }
.xarticle a { text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: .2em; text-decoration-color: var(--rule-c); }
`;
