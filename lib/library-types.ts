/** Shared by the reader UI and the library API. */

export type LibrarySection = { title: string; chars: number };

/**
 * The version of the arXiv-to-EPUB conversion (arxiv-epub.ts). A paper's ebook built by an older
 * version is rebuilt the next time it's opened. 2: figures arXiv embeds as SVG `<object>`s.
 */
export const ARXIV_EPUB_BUILD = 2;

/**
 * The version of the article-to-EPUB conversion (x-article-epub.ts: X Articles and web articles); older ones are rebuilt when opened.
 * 5: videos, audio and players (YouTube, Vimeo, Spotify…) play in place, posts on X as cards, equations, code in colour, tables with their links.
 */
export const ARTICLE_EPUB_BUILD = 5;

export type BookFormat = "epub" | "pdf";

export type LibraryBook = {
  id: string;
  /** Absent on EPUBs added before PDFs were supported. */
  format?: BookFormat;
  title: string;
  author: string;
  /** For a PDF of a clipped paper: the clipping's id. */
  paperId?: string;
  /** For an ebook made from another clipping (an article): the clipping's id. */
  clipId?: string;
  /** For an ebook made from a clipping: the ARXIV_EPUB_BUILD or ARTICLE_EPUB_BUILD that made it (absent: 1). */
  build?: number;
  /** The Goodreads shelf item this EPUB belongs to, when one matched. */
  shelfItemId?: string;
  /** Storage key of the extracted cover image. */
  coverKey?: string;
  /** The owner's note on the whole book (a clipping's is the clipping's own `note`). */
  note?: string;
  /** EPUB spine sections, or PDF pages, in reading order (same indices as the reader's sections). */
  sections: LibrarySection[];
  totalChars: number;
  bytes: number;
  addedAt: string;
};

export type Progress = {
  /** An EPUB CFI, or "page:N" (1-based) in a PDF. Empty when the Android app saved it: then `progression`. */
  cfi: string;
  /** Through the whole book, 0–1. */
  fraction: number;
  sectionIndex: number;
  /** EPUBs: how far through the section, 0–1, which both readers can go to. */
  progression?: number;
  updatedAt: string;
};

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export type Highlight = {
  id: string;
  /**
   * An EPUB CFI, or "page:N" in a PDF. Empty for a highlight made in the Android app until the web
   * reader first opens its section and finds it by its quote (lib/anchor.ts).
   */
  cfi: string;
  /** PDFs: the highlighted lines as [left, top, width, height], fractions of the page's size. */
  rects?: [number, number, number, number][];
  text: string;
  /** EPUBs: a little of the text on each side, so either reader can find the highlight again. */
  quote?: { before: string; after: string };
  /** EPUBs: how far into its section the highlight starts, 0–1. */
  progression?: number;
  color: HighlightColor;
  note?: string;
  /** The owner's own tags on it, as Readwise Reader has them. */
  tags?: string[];
  /** A drawing made with a stylus in the Android app, beside `text` (or on the PDF page). */
  ink?: Ink;
  sectionIndex: number;
  createdAt: string;
  /** The last change; the newer copy wins when two devices change the same highlight. */
  updatedAt?: string;
  /** Removed: kept a while as a marker, so a device that hasn't heard doesn't bring it back. */
  deleted?: boolean;
};

/**
 * A stylus drawing. On a PDF page (`place: "page"`) points are in units of the page's width, so
 * `size` is [1, height ÷ width] and the drawing scales with the page; in an EPUB's margin they are
 * in the drawing's own box, `size` [width, height], beside the paragraph the highlight's text starts. Its handwriting, read on the device, is kept
 * as `recognized`, so it can be searched and exported as text.
 */
export type Ink = {
  place: "page" | "margin";
  size: [number, number];
  /** In an EPUB's margin: where the drawing's box sits from its paragraph's corner, in its own units. */
  offset?: [number, number];
  strokes: InkStroke[];
  recognized?: string;
};

/** One stroke: a colour, a nib width (in the drawing's units), and points as x, y, pressure triples. */
export type InkStroke = { color: string; width: number; points: number[] };

/** A library entry as listed for the owner: the book plus where they are in it. */
export type LibraryEntry = LibraryBook & { progress?: Progress; coverUrl?: string };

/** A sentence of a narrated chapter: where it is in the chapter's text (see speech.ts) and in its audio, in seconds. */
export type AudioLine = { start: number; end: number; text: string; t0: number; t1: number };

/** A chapter read aloud in one voice. Its MP3 is in storage. */
export type AudioSection = { section: number; voice: string; duration: number; lines: AudioLine[] };
