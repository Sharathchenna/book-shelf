import type { Item, Status } from "./types";

// Pure helpers over the shelf's books; the books themselves come from lib/data.ts (D1).

export const STATUS_LABEL: Record<Status, string> = {
  read: "Read",
  reading: "Reading",
  "to-read": "To read",
};

export function getStats(items: Item[]) {
  const read = items.filter((i) => i.status === "read");
  const rated = items.filter((i) => i.rating);
  return {
    booksRead: read.length,
    pagesTurned: read.reduce((sum, i) => sum + (i.pages ?? 0), 0),
    averageRating: rated.length ? rated.reduce((sum, i) => sum + (i.rating ?? 0), 0) / rated.length : 0,
    readingNow: items.filter((i) => i.status === "reading").length,
    onTheList: items.filter((i) => i.status === "to-read").length,
  };
}

export function goodreadsUrl(item: Item): string {
  return item.goodreadsId
    ? `https://www.goodreads.com/book/show/${item.goodreadsId}`
    : `https://www.goodreads.com/search?q=${encodeURIComponent(`${item.title} ${item.author}`)}`;
}
