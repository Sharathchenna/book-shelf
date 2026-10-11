/** Shared by the reader UI and the library API. */

export type LibrarySection = { title: string; chars: number };

export type BookFormat = "epub" | "pdf";

export type LibraryBook = {
  id: string;
  /** Absent on EPUBs added before PDFs were supported. */
  format?: BookFormat;
  title: string;
  author: string;
  /** For a PDF of a clipped paper: the clipping's id. */
  paperId?: string;
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
