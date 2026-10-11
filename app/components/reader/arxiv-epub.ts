/**
 * Turns an arXiv paper's HTML version (LaTeXML output: real MathML, figures, numbered sections)
 * into an EPUB, so a paper reads like a book in the EPUB reader: reflowing text, themes, fonts,
 * highlights. Runs in the browser, which has the DOM tools this needs; the paper's HTML and
 * images come through the site's proxy routes. Returns null when there's no HTML version.
 */

type Meta = { paperId: string; arxiv: string; title: string; authors: string[] };
type Heading = { label: string; id: string; children: Heading[] };
type Chapter = { file: string; title: string; body: Element; subsections: Heading[] };

const XHTML = "http://www.w3.org/1999/xhtml";
const MAX_IMAGES = 250;

export async function buildArxivEpub(meta: Meta, onProgress: (label: string) => void): Promise<Blob | null> {
  onProgress("Fetching the paper…");
  const res = await fetch(`/api/books/papers/source?paperId=${encodeURIComponent(meta.paperId)}`);
  if (!res.ok) return null;
  const base = res.headers.get("x-source-url") ?? `https://arxiv.org/html/${meta.arxiv}/`;
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const article = doc.querySelector("article.ltx_document");
  if (!article) return null;

  clean(article);
  const notes = collectFootnotes(article, doc);

  // ---- chapters: a title page, then each top-level section, appendix and the references ----
  const chapters: Chapter[] = [];
  const front = doc.createElement("section");
  front.className = "front";
  let current: Chapter = { file: "front.xhtml", title: "Title page", body: front, subsections: [] };
  chapters.push(current);
  for (const child of [...article.children]) {
    const isSection = child.matches("section.ltx_section, section.ltx_appendix, section.ltx_bibliography, section.ltx_chapter");
    if (isSection) {
      const heading = child.querySelector(":scope > h2, :scope > h1, :scope > h3");
      current = {
        file: `s${chapters.length}.xhtml`,
        title: label(heading) || (child.classList.contains("ltx_bibliography") ? "References" : `Section ${chapters.length}`),
        body: child,
        subsections: headings(child, "ltx_subsection", "ltx_subsubsection"),
      };
      chapters.push(current);
    } else {
      current.body.append(child);
    }
  }
  // Footnotes go at the end of the chapter that refers to them.
  for (const chapter of chapters) {
    const ids = [...chapter.body.querySelectorAll("a[data-footnote]")].map((a) => a.getAttribute("data-footnote")!);
    if (!ids.length) continue;
    const list = doc.createElement("aside");
    list.className = "footnotes";
    for (const id of ids) if (notes.has(id)) list.append(notes.get(id)!);
    chapter.body.append(list);
  }

  // ---- links between chapters ----
  const fileOf = new Map<string, string>();
  for (const chapter of chapters) {
    if (chapter.body.id) fileOf.set(chapter.body.id, chapter.file);
    for (const el of chapter.body.querySelectorAll("[id]")) fileOf.set(el.id, chapter.file);
  }
  for (const chapter of chapters) {
    for (const a of chapter.body.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href")!;
      const url = new URL(href, base);
      const samePaper = url.host === "arxiv.org" && url.pathname.replace(/\/$/, "") === new URL(base).pathname.replace(/\/$/, "");
      const id = href.startsWith("#") ? decodeURIComponent(href.slice(1)) : samePaper && url.hash ? decodeURIComponent(url.hash.slice(1)) : null;
      if (id !== null) {
        const file = fileOf.get(id);
        if (file) a.setAttribute("href", `${file === chapter.file ? "" : file}#${id}`);
        else a.removeAttribute("href");
      } else {
        a.setAttribute("href", url.href);
      }
      a.removeAttribute("target");
    }
  }

  // ---- figures ----
  // Most of arXiv's vector figures are SVG `<object>`s, which EPUB readers don't load: make them images.
  for (const chapter of chapters) {
    for (const object of chapter.body.querySelectorAll("object[data]")) {
      const data = object.getAttribute("data")!;
      if (!(object.getAttribute("type") ?? "").startsWith("image/") && !/\.(svg|png|jpe?g|gif|webp)$/i.test(data)) continue;
      const img = object.ownerDocument.createElement("img");
      img.setAttribute("src", data);
      img.className = object.className;
      object.replaceWith(img);
    }
  }
  const images: { path: string; data: Blob }[] = [];
  const imgs = chapters.flatMap((c) => [...c.body.querySelectorAll("img[src]")]).slice(0, MAX_IMAGES);
  let done = 0;
  await pool(imgs, 4, async (img) => {
    const src = new URL(img.getAttribute("src")!, base).href;
    const res = await fetch(`/api/books/papers/asset?paperId=${encodeURIComponent(meta.paperId)}&url=${encodeURIComponent(src)}`).catch(() => null);
    if (res?.ok) {
      const type = res.headers.get("content-type") ?? "image/png";
      const ext = type.includes("svg") ? "svg" : type.includes("jpeg") ? "jpg" : type.split("/")[1]?.split(";")[0] || "png";
      const path = `images/f${images.length + 1}.${ext}`;
      images.push({ path, data: await res.blob() });
      img.setAttribute("src", path);
    } else {
      img.remove();
    }
    for (const attr of ["srcset", "loading", "width", "height"]) img.removeAttribute(attr);
    if (!img.hasAttribute("alt")) img.setAttribute("alt", "");
    onProgress(`Fetching figures ${++done} of ${imgs.length}…`);
  });

  // ---- package ----
  onProgress("Binding the book…");
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
  const serializer = new XMLSerializer();
  for (const chapter of chapters) {
    const body = chapter.body.ownerDocument.createElementNS(XHTML, "div");
    body.append(...chapter.body.childNodes);
    const xhtml = serializer.serializeToString(body);
    oebps.file(
      chapter.file,
      `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(chapter.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body class="paper">${xhtml}</body></html>`,
    );
  }
  oebps.file("nav.xhtml", nav(chapters, meta.title));
  oebps.file("content.opf", opf(meta, chapters, images));

  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}

/** Drops the page chrome LaTeXML adds around and inside the paper. */
function clean(article: Element) {
  article
    .querySelectorAll("script, style, link, button, nav, .ltx_page_header, .ltx_page_footer, .ltx_ERROR, .html-feedback, .sr-only")
    .forEach((el) => el.remove());
  for (const el of article.querySelectorAll("[style]")) el.removeAttribute("style");
  for (const el of article.querySelectorAll("*")) {
    for (const attr of [...el.attributes]) if (attr.name.startsWith("on") || attr.name.startsWith("data-")) el.removeAttribute(attr.name);
  }
}

/**
 * LaTeXML puts each footnote's text inline, inside the sentence, for a hover popup. Here each
 * becomes a numbered note at the end of its chapter, with the mark linking to it.
 */
function collectFootnotes(article: Element, doc: Document): Map<string, Element> {
  const notes = new Map<string, Element>();
  let n = 0;
  for (const note of article.querySelectorAll(".ltx_note.ltx_role_footnote")) {
    const content = note.querySelector(".ltx_note_content");
    const mark = note.querySelector(".ltx_note_mark")?.textContent?.trim() || String(n + 1);
    const id = `fn${++n}`;
    content?.querySelector(".ltx_note_mark")?.remove();
    const item = doc.createElement("p");
    item.id = id;
    item.className = "footnote";
    const back = doc.createElement("sup");
    back.textContent = mark;
    item.append(back, " ", ...(content ? [...content.childNodes] : []));
    notes.set(id, item);

    const link = doc.createElement("a");
    link.setAttribute("href", `#${id}`);
    link.setAttribute("data-footnote", id);
    link.className = "noteref";
    const sup = doc.createElement("sup");
    sup.textContent = mark;
    link.append(sup);
    note.replaceWith(link);
  }
  return notes;
}

/** A section's subsections (and theirs, one level down) for the contents. */
function headings(section: Element, level: string, next?: string): Heading[] {
  return [...section.querySelectorAll(`:scope > section.${level}`)]
    .map((sub) => ({
      label: label(sub.querySelector(":scope > h3, :scope > h4, :scope > h5")),
      id: sub.id,
      children: next ? headings(sub, next) : [],
    }))
    .filter((h) => h.label && h.id);
}

/** A heading's text: "3.2 Scaled Dot-Product Attention", the number kept for (§3.2) citations. */
function label(heading: Element | null): string {
  return (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function nav(chapters: Chapter[], title: string): string {
  const list = (file: string, items: Heading[]): string =>
    items.length
      ? `<ol>${items.map((h) => `<li><a href="${file}#${esc(h.id)}">${esc(h.label)}</a>${list(file, h.children)}</li>`).join("")}</ol>`
      : "";
  const items = chapters.map((c) => `<li><a href="${c.file}">${esc(c.title)}</a>${list(c.file, c.subsections)}</li>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="${XHTML}" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${items}</ol></nav></body></html>`;
}

function opf(meta: Meta, chapters: Chapter[], images: { path: string; data: Blob }[]): string {
  const mime = (path: string) =>
    ({ svg: "image/svg+xml", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" })[path.split(".").pop()!] ?? "image/png";
  const creators = meta.authors
    .slice(0, 12)
    .map((a, i) => `<dc:creator id="a${i}">${esc(a)}</dc:creator>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id" xml:lang="en">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="id">urn:arxiv:${esc(meta.arxiv)}</dc:identifier>
<dc:title>${esc(meta.title)}</dc:title>${creators}
<dc:language>en</dc:language>
<dc:source>https://arxiv.org/abs/${esc(meta.arxiv)}</dc:source>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="css" href="style.css" media-type="text/css"/>
${chapters.map((c, i) => `<item id="c${i}" href="${c.file}" media-type="application/xhtml+xml"${c.body.querySelector("math") ? ' properties="mathml"' : ""}/>`).join("\n")}
${images.map((img, i) => `<item id="i${i}" href="${img.path}" media-type="${mime(img.path)}"/>`).join("\n")}
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

/**
 * Just enough styling for LaTeXML's structure; the reader's theme, font and size settings apply
 * on top (see bookCss in foliate.ts).
 */
const STYLE = `
.paper h1.ltx_title_document { font-size: 1.6em; line-height: 1.25; margin: 0 0 .6em; }
.paper .ltx_authors { font-size: .9em; margin-bottom: 1.4em; }
.paper .ltx_personname { font-weight: 600; }
.paper .ltx_author_notes, .paper .ltx_role_affiliation, .paper .ltx_contact { display: block; font-size: .85em; opacity: .75; }
.paper .ltx_creator { display: inline-block; margin: 0 1.2em .6em 0; vertical-align: top; }
.paper .ltx_abstract { margin: 1.4em 0; }
.paper .ltx_abstract h6, .paper .ltx_title_abstract { font-size: .8em; letter-spacing: .12em; text-transform: uppercase; opacity: .7; }
.paper h2 { font-size: 1.35em; line-height: 1.3; margin: 1.2em 0 .6em; }
.paper h3 { font-size: 1.15em; margin: 1.2em 0 .5em; }
.paper h4, .paper h5 { font-size: 1em; margin: 1em 0 .4em; }
.paper .ltx_tag { margin-right: .4em; }
.paper figure, .paper .ltx_figure, .paper .ltx_table { margin: 1.4em 0; text-align: center; break-inside: avoid; }
.paper img { max-width: 100%; height: auto; }
.paper figcaption, .paper .ltx_caption { font-size: .85em; line-height: 1.45; text-align: start; margin-top: .5em; opacity: .85; }
.paper table { border-collapse: collapse; margin: 0 auto; font-size: .82em; max-width: 100%; }
.paper .ltx_tabular td, .paper .ltx_tabular th { padding: .2em .5em; }
.paper .ltx_border_t { border-top: 1px solid currentColor; }
.paper .ltx_border_b { border-bottom: 1px solid currentColor; }
.paper .ltx_border_tt { border-top: 2px solid currentColor; }
.paper .ltx_border_bb { border-bottom: 2px solid currentColor; }
.paper .ltx_border_r { border-right: 1px solid currentColor; }
.paper .ltx_border_l { border-left: 1px solid currentColor; }
.paper table.ltx_equation, .paper table.ltx_eqn_table { width: 100%; margin: .8em 0; font-size: 1em; }
.paper .ltx_eqn_cell { padding: 0; }
.paper .ltx_eqn_center_padleft, .paper .ltx_eqn_center_padright { width: 50%; }
.paper .ltx_eqn_eqno { text-align: right; white-space: nowrap; padding-left: .8em; opacity: .7; }
.paper math[display="block"] { display: block; margin: .4em 0; overflow-x: auto; }
.paper .ltx_theorem, .paper .ltx_proof { margin: 1em 0; }
.paper .ltx_title_theorem { font-weight: 700; }
.paper .ltx_bibliography .ltx_bibitem { font-size: .85em; margin: .5em 0; }
.paper .ltx_bibblock { display: inline; }
.paper .ltx_listing, .paper pre { font-size: .8em; white-space: pre-wrap; }
.paper .ltx_itemize, .paper .ltx_enumerate { padding-left: 1.4em; }
.paper .footnotes { margin-top: 2em; padding-top: .8em; border-top: 1px solid currentColor; font-size: .8em; opacity: .85; }
.paper .footnote { margin: .4em 0; }
.paper a.noteref { text-decoration: none; }
.paper .ltx_note_outer { display: none; }
`;
