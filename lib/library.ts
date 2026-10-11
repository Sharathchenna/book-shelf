import "server-only";
import type { LibraryBook } from "./library-types";
import { shelf } from "./shelf";
import { getJson, putJson } from "./storage";

/** Storage layout for the owner's EPUB library. */
export const keys = {
  index: "library.json",
  epub: (id: string) => `books/${id}.epub`,
  text: (id: string) => `text/${id}.json`,
  progress: (id: string) => `progress/${id}.json`,
  notes: (id: string) => `notes/${id}.json`,
  cover: (id: string, ext: string) => `covers/${id}.${ext}`,
};

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

/** The shelf item an uploaded EPUB belongs to: same title (before any subtitle) and author surname. */
export function matchShelfItem(title: string, author: string): string | undefined {
  const t = normalize(title);
  const surname = normalize(author).split(" ").at(-1) ?? "";
  return shelf.items.find((item) => {
    const itemTitle = normalize(item.title);
    const sameTitle = itemTitle === t || itemTitle.startsWith(`${t} `) || t.startsWith(`${itemTitle} `);
    return sameTitle && normalize(item.author).includes(surname);
  })?.id;
}
