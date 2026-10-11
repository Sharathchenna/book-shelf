/** Shared by the reader UI and the library API. */

export type LibrarySection = { title: string; chars: number };

export type LibraryBook = {
  id: string;
  title: string;
  author: string;
  /** The Goodreads shelf item this EPUB belongs to, when one matched. */
  shelfItemId?: string;
  /** Storage key of the extracted cover image. */
  coverKey?: string;
  /** Spine sections, in reading order (same indices as the reader's sections). */
  sections: LibrarySection[];
  totalChars: number;
  bytes: number;
  addedAt: string;
};

export type Progress = {
  cfi: string;
  /** Through the whole book, 0–1. */
  fraction: number;
  sectionIndex: number;
  updatedAt: string;
};

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

export type Highlight = {
  id: string;
  cfi: string;
  text: string;
  color: HighlightColor;
  note?: string;
  sectionIndex: number;
  createdAt: string;
};

/** A library entry as listed for the owner: the book plus where they are in it. */
export type LibraryEntry = LibraryBook & { progress?: Progress; coverUrl?: string };
