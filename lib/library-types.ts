/** Shared by the reader UI and the library API. */

export type LibrarySection = { title: string; chars: number };

/**
 * The version of the arXiv-to-EPUB conversion (arxiv-epub.ts). A paper's ebook built by an older
 * version is rebuilt the next time it's opened. 2: figures arXiv embeds as SVG `<object>`s.
 */
export const ARXIV_EPUB_BUILD = 2;

/** The version of the article-to-EPUB conversion (x-article-epub.ts: X Articles and web articles); older ones are rebuilt when opened. */
export const ARTICLE_EPUB_BUILD = 3;

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
  /** EPUB spine sections, or PDF pages, in reading order (same indices as the reader's sections). */
  sections: LibrarySection[];
  totalChars: number;
  bytes: number;
  addedAt: string;
};

export type Progress = {
  /** An EPUB CFI, or "page:N" (1-based) in a PDF. */
  cfi: string;
  /** Through the whole book, 0–1. */
  fraction: number;
  sectionIndex: number;
  updatedAt: string;
};

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export type Highlight = {
  id: string;
  /** An EPUB CFI, or "page:N" in a PDF. */
  cfi: string;
  /** PDFs: the highlighted lines as [left, top, width, height], fractions of the page's size. */
  rects?: [number, number, number, number][];
  text: string;
  color: HighlightColor;
  note?: string;
  sectionIndex: number;
  createdAt: string;
};

/** A library entry as listed for the owner: the book plus where they are in it. */
export type LibraryEntry = LibraryBook & { progress?: Progress; coverUrl?: string };

/** A sentence of a narrated chapter: where it is in the chapter's text (see speech.ts) and in its audio, in seconds. */
export type AudioLine = { start: number; end: number; text: string; t0: number; t1: number };

/** A chapter read aloud in one voice. Its MP3 is in storage. */
export type AudioSection = { section: number; voice: string; duration: number; lines: AudioLine[] };
