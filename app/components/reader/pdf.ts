/**
 * A thin layer over pdf.js for the reader: loading it, opening documents, and reading a PDF's
 * text, outline and first page when it's added to the library. Browser-only: call it from an
 * effect or event handler. pdf.js itself, its worker and data files are served from /pdfjs
 * (scripts/copy-pdfjs.ts) and loaded at runtime, so they stay out of every bundle.
 */
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type { TocItem } from "./foliate";

export type { PDFDocumentProxy, PDFPageProxy };

type PdfJs = typeof import("pdfjs-dist");
let pdfjs: Promise<PdfJs> | undefined;

const LIBRARY_URL = "/pdfjs/pdf.min.mjs";

export function loadPdfjs(): Promise<PdfJs> {
  // An absolute URL built at runtime: bundlers (Turbopack, then OpenNext's esbuild) leave it alone.
  const url = new URL(LIBRARY_URL, location.href).href;
  pdfjs ??= (import(/* turbopackIgnore: true */ /* webpackIgnore: true */ url) as Promise<PdfJs>).then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    return lib;
  });
  return pdfjs;
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const { getDocument } = await loadPdfjs();
  return getDocument({
    data: new Uint8Array(data),
    cMapUrl: "/pdfjs/cmaps/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
    wasmUrl: "/pdfjs/wasm/",
    iccUrl: "/pdfjs/iccs/",
  }).promise;
}

/** A page's text in reading order, with line breaks kept and words split across lines rejoined. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    text += item.str + (item.hasEOL ? "\n" : "");
  }
  return text
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

/** The PDF's bookmarks as a table of contents; each href is "page:N". */
export async function outline(doc: PDFDocumentProxy): Promise<TocItem[]> {
  const entries = (await doc.getOutline().catch(() => null)) ?? [];
  type Entry = (typeof entries)[number];
  const pageOf = async (entry: Entry): Promise<number | null> => {
    try {
      const dest = typeof entry.dest === "string" ? await doc.getDestination(entry.dest) : entry.dest;
      const ref = dest?.[0];
      if (ref === undefined || ref === null) return null;
      return (typeof ref === "number" ? ref : await doc.getPageIndex(ref)) + 1;
    } catch {
      return null;
    }
  };
  const convert = async (items: Entry[]): Promise<TocItem[]> => {
    const out: TocItem[] = [];
    for (const item of items) {
      const page = await pageOf(item);
      const subitems = item.items?.length ? await convert(item.items) : undefined;
      // Entries without a page (links elsewhere) still group their children.
      const href = page ? `page:${page}` : subitems?.[0]?.href;
      if (href) out.push({ label: item.title.trim(), href, ...(subitems?.length ? { subitems } : {}) });
    }
    return out;
  };
  return convert(entries);
}

/** Every outline entry, flattened and in page order, for "which section is page N in". */
export function flatOutline(toc: TocItem[]): { label: string; page: number; href: string }[] {
  const flat: { label: string; page: number; href: string }[] = [];
  const walk = (items: TocItem[]) => {
    for (const item of items) {
      flat.push({ label: item.label, page: Number(item.href.slice(5)), href: item.href });
      if (item.subitems) walk(item.subitems);
    }
  };
  walk(toc);
  return flat.sort((a, b) => a.page - b.page);
}

export function sectionAt(flat: ReturnType<typeof flatOutline>, page: number) {
  return flat.findLast((entry) => entry.page <= page);
}

export type ReadPdf = {
  title?: string;
  author?: string;
  pages: { title: string; text: string }[];
  /** JPEG of the first page, base64. */
  cover?: string;
};

/** Everything the library needs from a PDF: per-page text and titles, metadata and a cover. */
export async function readPdf(doc: PDFDocumentProxy, onProgress: (done: number, total: number) => void): Promise<ReadPdf> {
  const flat = flatOutline(await outline(doc));
  const pages: ReadPdf["pages"] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const section = sectionAt(flat, n);
    pages.push({ title: section ? `${section.label} · p. ${n}` : `Page ${n}`, text: await pageText(page) });
    page.cleanup();
    onProgress(n, doc.numPages);
  }

  const { info } = (await doc.getMetadata().catch(() => ({ info: {} }))) as { info: { Title?: string; Author?: string } };
  return {
    title: meaningful(info.Title) ?? (await largestText(doc)),
    author: meaningful(info.Author),
    pages,
    cover: await coverJpeg(doc),
  };
}

/** Without a metadata title, the biggest upright text on the first page is almost always the title. */
async function largestText(doc: PDFDocumentProxy): Promise<string | undefined> {
  const content = await (await doc.getPage(1)).getTextContent();
  // Upright runs only: arXiv's sideways identifier in the margin is often the largest text.
  const runs = content.items.filter(
    (item): item is Extract<(typeof content.items)[number], { str: string }> =>
      "str" in item && item.str.trim() !== "" && Math.abs(item.transform[1]) < 0.01 && Math.abs(item.transform[2]) < 0.01,
  );
  if (!runs.length) return undefined;
  const heights = runs.map((r) => r.height).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)];
  const max = heights.at(-1)!;
  if (max < median * 1.3) return undefined;
  const title = runs
    .filter((r) => r.height >= max * 0.92)
    .map((r) => r.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return title.length >= 4 && title.length <= 200 ? title : undefined;
}

/** Metadata titles are often leftovers from whatever made the PDF ("Microsoft Word - draft.docx"). */
function meaningful(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v || v.length < 3 || /^(untitled|microsoft word|title)\b|\.(docx?|tex|dvi|pdf|indd)$/i.test(v)) return undefined;
  return v;
}

async function coverJpeg(doc: PDFDocumentProxy): Promise<string | undefined> {
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 600 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return toBase64Jpeg(canvas, 0.82);
  } catch {
    return undefined;
  }
}

export function toBase64Jpeg(canvas: HTMLCanvasElement, quality = 0.85): string {
  return canvas.toDataURL("image/jpeg", quality).split(",")[1];
}

/**
 * The browser's half of adding a PDF to the library: after the file is in storage, read its
 * pages and send the text, outline titles and cover to finalize.
 */
export async function finalizePdf(
  id: string,
  data: ArrayBuffer,
  opts: { fileName?: string; paperId?: string; onProgress: (done: number, total: number) => void },
): Promise<void> {
  const doc = await openPdf(data);
  let read: ReadPdf;
  try {
    read = await readPdf(doc, opts.onProgress);
  } finally {
    void doc.loadingTask.destroy();
  }
  const fromName = opts.fileName?.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
  const res = await fetch(`/api/books/${id}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      format: "pdf",
      paperId: opts.paperId,
      title: read.title ?? fromName,
      author: read.author,
      pages: read.pages,
      cover: read.cover,
    }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Couldn't add that PDF.");
  }
}
