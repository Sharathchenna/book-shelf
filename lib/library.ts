import "server-only";
import type { LibraryBook } from "./library-types";
import { shelf } from "./shelf";
import { getJson, putJson } from "./storage";

/** Storage layout for the owner's library. */
export const keys = {
  index: "library.json",
  file: (book: Pick<LibraryBook, "id" | "format">) => `books/${book.id}.${book.format ?? "epub"}`,
  text: (id: string) => `text/${id}.json`,
  progress: (id: string) => `progress/${id}.json`,
  notes: (id: string) => `notes/${id}.json`,
  cover: (id: string, ext: string) => `covers/${id}.${ext}`,
};

export const CONTENT_TYPES = { epub: "application/epub+zip", pdf: "application/pdf" } as const;

/** Book ids are generated server-side; anything else is rejected before touching storage. */
export const validId = (id: string) => /^[a-z0-9]{8,32}$/.test(id);

export async function readIndex(): Promise<LibraryBook[]> {
  return (await getJson<LibraryBook[]>(keys.index)) ?? [];
}

export function writeIndex(books: LibraryBook[]): Promise<void> {
  return putJson(keys.index, books);
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .split(/[:(]/)[0]
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * The shelf book a file belongs to: the one it was added from, or else one with the same title
 * and author. Matched when read, not only at upload, so a file added before its book was on
 * Goodreads finds it after the next sync.
 */
export function shelfItemFor(book: Pick<LibraryBook, "shelfItemId" | "paperId" | "title" | "author">): string | undefined {
  if (book.shelfItemId && shelf.items.some((i) => i.id === book.shelfItemId)) return book.shelfItemId;
  return book.paperId ? undefined : matchShelfItem(book.title, book.author);
}

/** The shelf item an uploaded book belongs to: same title (before any subtitle) and author surname. */
export function matchShelfItem(title: string, author: string): string | undefined {
  const t = normalize(title);
  const surname = normalize(author).split(" ").at(-1) ?? "";
  return shelf.items.find((item) => {
    const itemTitle = normalize(item.title);
    const sameTitle = itemTitle === t || itemTitle.startsWith(`${t} `) || t.startsWith(`${itemTitle} `);
    return sameTitle && normalize(item.author).includes(surname);
  })?.id;
}
