import "server-only";
import JSZip from "jszip";

/**
 * Reads what the server needs from an EPUB: metadata, the cover, and plain text for each
 * spine item (in spine order, matching the reader's section indices). Rendering is done in
 * the browser by foliate-js; this only feeds the library and the reader's AI features.
 */
export type ParsedEpub = {
  title: string;
  author: string;
  cover?: { bytes: Uint8Array; type: string; ext: string };
  sections: { title: string; text: string }[];
};

const decodeEntities = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"))?.slice(2).find((v) => v !== undefined);
}

function tagText(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"));
  return m ? decodeEntities(m[1].replace(/<[^>]+>/g, "")).trim() : undefined;
}

/** XHTML to readable plain text: block elements become line breaks, everything else is dropped. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, "")
      // Equations as their LaTeX (papers converted from arXiv carry it), not their rendered glyphs.
      .replace(/<math\b[^>]*\balttext\s*=\s*"([^"]*)"[^>]*>[\s\S]*?<\/math>/gi, (_, tex: string) => ` $${tex}$ `)
      .replace(/<annotation(-xml)?\b[\s\S]*?<\/annotation(-xml)?>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|h[1-6]|li|blockquote|section|tr|dt|dd)>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const resolve = (base: string, href: string) => {
  const parts = (base.includes("/") ? base.slice(0, base.lastIndexOf("/") + 1) : "").concat(href.split("#")[0]).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(decodeURIComponent(part));
  }
  return out.join("/");
};

export async function parseEpub(bytes: Uint8Array): Promise<ParsedEpub> {
  const zip = await JSZip.loadAsync(bytes);
  const read = (path: string) => zip.file(path)?.async("string");

  const container = await read("META-INF/container.xml");
  const opfPath = container && attr(container.match(/<rootfile\b[^>]*>/i)?.[0] ?? "", "full-path");
  const opf = opfPath && (await read(opfPath));
  if (!opfPath || !opf) throw new Error("This file isn't a valid EPUB (no package document).");

  const manifest = new Map<string, { href: string; type: string; properties: string }>();
  for (const tag of opf.match(/<item\b[^>]*>/gi) ?? []) {
    const id = attr(tag, "id");
    const href = attr(tag, "href");
    if (id && href) {
      manifest.set(id, {
        href: resolve(opfPath, href),
        type: attr(tag, "media-type") ?? "",
        properties: attr(tag, "properties") ?? "",
      });
    }
  }
  const spine = (opf.match(/<itemref\b[^>]*>/gi) ?? [])
    .map((tag) => manifest.get(attr(tag, "idref") ?? ""))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  // Chapter titles from the EPUB 3 nav document, or the EPUB 2 NCX.
  const titles = new Map<string, string>();
  const nav = [...manifest.values()].find((i) => i.properties.split(/\s+/).includes("nav"));
  const navXml = nav && (await read(nav.href));
  if (navXml) {
    const toc = navXml.match(/<nav\b[^>]*epub:type\s*=\s*["']toc["'][\s\S]*?<\/nav>/i)?.[0] ?? navXml;
    for (const a of toc.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = attr(a[0], "href");
      const label = decodeEntities(a[2].replace(/<[^>]+>/g, "")).trim();
      if (href && label) {
        const path = resolve(nav!.href, href);
        if (!titles.has(path)) titles.set(path, label);
      }
    }
  } else {
    const ncx = [...manifest.values()].find((i) => i.type === "application/x-dtbncx+xml");
    const ncxXml = ncx && (await read(ncx.href));
    for (const point of ncxXml?.matchAll(/<navPoint\b[\s\S]*?<content\b[^>]*>/gi) ?? []) {
      const src = attr(point[0].match(/<content\b[^>]*>/i)?.[0] ?? "", "src");
      const label = tagText(point[0], "text");
      if (src && label) {
        const path = resolve(ncx!.href, src);
        if (!titles.has(path)) titles.set(path, label);
      }
    }
  }

  const sections = await Promise.all(
    spine.map(async (item, i) => {
      const html = (await read(item.href)) ?? "";
      const heading = tagText(html, "h1") ?? tagText(html, "h2") ?? tagText(html, "title");
      return { title: titles.get(item.href) ?? heading ?? `Section ${i + 1}`, text: htmlToText(html) };
    }),
  );

  // Cover: EPUB 3 "cover-image" property, or the EPUB 2 <meta name="cover"> convention.
  const coverMetaId = attr(opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*>/i)?.[0] ?? "", "content");
  const coverItem =
    [...manifest.values()].find((i) => i.properties.split(/\s+/).includes("cover-image")) ??
    (coverMetaId ? manifest.get(coverMetaId) : undefined);
  let cover: ParsedEpub["cover"];
  if (coverItem?.type.startsWith("image/")) {
    const data = await zip.file(coverItem.href)?.async("uint8array");
    if (data) cover = { bytes: data, type: coverItem.type, ext: coverItem.type.split("/")[1].replace("jpeg", "jpg").replace("+xml", "") };
  }

  return {
    title: tagText(opf, "title") ?? "Untitled",
    author: tagText(opf, "creator") ?? "Unknown author",
    cover,
    sections,
  };
}
