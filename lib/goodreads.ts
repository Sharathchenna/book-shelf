import { fallbackColor, hashString } from "./color";
import type { Item, Status } from "./types";

export const STATUS: Record<string, Status> = {
  read: "read",
  "currently-reading": "reading",
  "to-read": "to-read",
};

/** What Goodreads knows about a book on someone's shelf, from its RSS feed. */
type Shelved = {
  goodreadsId?: string;
  title: string;
  author: string;
  year?: number;
  pages?: number;
  format?: string;
  status: Status;
  rating?: number;
  dateRead?: string;
  dateAdded?: string;
  review?: string;
  shelves: string[];
  isbn?: string;
  cover?: string;
  description?: string;
};

function toItem(book: Shelved): Item {
  const { title, series } = splitSeries(book.title.trim());
  const author = book.author.replace(/\s+/g, " ").trim();
  const id = book.goodreadsId ? `gr${book.goodreadsId}` : `b${hashString(`${title}|${author}`).toString(36)}`;
  return {
    id,
    kind: "book",
    title,
    series,
    author,
    year: book.year,
    pages: book.pages,
    format: book.format,
    status: book.status,
    rating: book.rating || undefined,
    dateRead: book.dateRead,
    dateAdded: book.dateAdded,
    review: book.review,
    tags: book.shelves.map((s) => s.trim()).filter((s) => s && !(s in STATUS)),
    subjects: [],
    category: "",
    isbn: book.isbn,
    goodreadsId: book.goodreadsId,
    cover: book.cover,
    color: fallbackColor(id),
    description: book.description,
  };
}

/**
 * Turns one page of a shelf's RSS feed (goodreads.com/review/list_rss/<user>?shelf=<shelf>)
 * into shelf items (not yet enriched). The feed is per exclusive shelf, so the caller passes its status.
 */
export function parseGoodreadsRss(xml: string, status: Status): Item[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
    const field = (tag: string) => {
      const raw = item.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
      return decode(raw.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/, "$1")).trim();
    };
    const cover = field("book_large_image_url");
    return toItem({
      goodreadsId: field("book_id") || undefined,
      title: field("title"),
      author: field("author_name"),
      year: int(field("book_published")),
      pages: int(field("num_pages")),
      status,
      rating: int(field("user_rating")),
      dateRead: rssDate(field("user_read_at")),
      dateAdded: rssDate(field("user_date_added")),
      review: text(field("user_review")),
      shelves: field("user_shelves").split(","),
      isbn: isbn(field("isbn")),
      // Books without a cover get a "nophoto" placeholder; a generated cover looks better.
      cover: cover && !cover.includes("nophoto") ? cover : undefined,
      description: text(field("book_description")),
    });
  });
}

/** "The Way of Kings (The Stormlight Archive, #1)" → title + "The Stormlight Archive #1". */
function splitSeries(raw: string): { title: string; series?: string } {
  const m = raw.match(/^(.*\S)\s+\(([^()]+?),?\s*#([\d.]+(?:-\d+)?)\)$/);
  return m ? { title: m[1], series: `${m[2]} #${m[3]}` } : { title: raw };
}

function int(s: string | undefined): number | undefined {
  const n = parseInt(s ?? "", 10);
  return Number.isFinite(n) ? n : undefined;
}

/** The feed writes dates like "Wed, 25 Nov 2015 01:18:44 -0800"; the calendar day as written is the one meant. */
function rssDate(s: string): string | undefined {
  const m = s.match(/(\d{1,2}) (\w{3}) (\d{4})/);
  if (!m) return undefined;
  const month = "JanFebMarAprMayJunJulAugSepOctNovDec".indexOf(m[2]) / 3 + 1;
  return month ? `${m[3]}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}` : undefined;
}

/** Goodreads wraps ISBNs as ="0439023483" so spreadsheets keep leading zeros. */
function isbn(s: string | undefined): string | undefined {
  const v = s?.replace(/[^0-9X]/gi, "");
  return v || undefined;
}

/** Reviews and descriptions are HTML; keep the line breaks, drop the tags. */
function text(s: string | undefined): string | undefined {
  const plain = decode(
    s
      ?.replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, "") ?? "",
  ).trim();
  return plain || undefined;
}

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
