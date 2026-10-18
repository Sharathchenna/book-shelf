import { inkSvg } from "./ink";
import type { Highlight } from "./library-types";

/**
 * Highlights and notes as Markdown (from Gloss): one book's, in reading order, with YAML front
 * matter, ready to drop into Obsidian. The reader's notes panel copies one; the library exports
 * them all as a zip of files. Explain's and the other answers saved as notes come along as notes.
 */

export type NotesMeta = {
  title: string;
  author?: string;
  kind: "book" | "paper" | "article" | "post";
  /** Where it came from: the paper, the article, or the book's Goodreads page. */
  url?: string;
  /** Chapter (or page) titles, by section index. */
  sections: string[];
};

const yaml = (s: string) => JSON.stringify(s);
const day = (iso: string) => iso.slice(0, 10);

/** Where a highlight is: its section, then its page in a PDF ("page:12"), then when it was made. */
const order = (a: Highlight, b: Highlight) =>
  a.sectionIndex - b.sectionIndex || (Number(a.cfi.match(/^page:(\d+)/)?.[1]) || 0) - (Number(b.cfi.match(/^page:(\d+)/)?.[1]) || 0) || a.createdAt.localeCompare(b.createdAt);

/**
 * `ink` says how a drawing from the Android app goes into the Markdown: the zip export saves each
 * as an SVG file beside the notes and embeds it (`![[…]]`); otherwise it's inline SVG, which
 * Obsidian shows as it is.
 */
export function notesMarkdown(
  meta: NotesMeta,
  highlights: Highlight[],
  { frontmatter = true, ink = (h: Highlight) => inkSvg(h.ink!, { standalone: true }) }: { frontmatter?: boolean; ink?: (h: Highlight) => string } = {},
): string {
  const sorted = highlights.toSorted(order);
  const out: string[] = [];
  if (frontmatter) {
    out.push(
      "---",
      `title: ${yaml(meta.title)}`,
      ...(meta.author ? [`author: ${yaml(meta.author)}`] : []),
      `type: ${meta.kind}`,
      ...(meta.url ? [`source: ${yaml(meta.url)}`] : []),
      `highlights: ${sorted.length}`,
      ...(sorted.length ? [`updated: ${day(sorted.map((h) => h.createdAt).sort().at(-1)!)}`] : []),
      "tags: [reading]",
      "---",
      "",
    );
  }
  out.push(`# ${meta.title}`, "");
  if (meta.author) out.push(`*${meta.author}*`, "");
  let section = -1;
  for (const h of sorted) {
    if (h.sectionIndex !== section) {
      section = h.sectionIndex;
      const title = meta.sections[section];
      if (title) out.push(`## ${title}`, "");
    }
    out.push(...h.text.trim().split(/\n+/).map((line) => `> ${line}`));
    out.push("");
    if (h.ink) {
      out.push(ink(h), "");
      if (h.ink.recognized?.trim()) out.push(`*Ink:* ${h.ink.recognized.trim().replace(/\s+/g, " ")}`, "");
    }
    if (h.note?.trim()) out.push(h.note.trim(), "");
    out.push(`<small>${h.color} · ${day(h.createdAt)}</small>`, "");
  }
  if (!sorted.length) out.push("No highlights yet.", "");
  return out.join("\n");
}

/** A file name Obsidian (and every OS) accepts, from a title. */
export function fileName(title: string, ext = "md"): string {
  const name = title
    .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  return `${name || "Untitled"}.${ext}`;
}
