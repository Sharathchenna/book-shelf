import { fallbackColor, hashString } from "./color";
import { parseCsv } from "./csv";
import type { Item, Status } from "./types";

const STATUS: Record<string, Status> = {
  read: "read",
  "currently-reading": "reading",
  "to-read": "to-read",
};

/** Turns a Goodreads "Export Library" CSV into shelf items (not yet enriched). */
export function parseGoodreads(csv: string): Item[] {
  const rows = parseCsv(csv);
  if (rows.length && !("Title" in rows[0] && "Author" in rows[0])) {
    throw new Error("This does not look like a Goodreads export: it has no Title and Author columns.");
  }

  return rows
    .filter((r) => r.Title?.trim())
    .map((r): Item => {
      const { title, series } = splitSeries(r.Title.trim());
      const author = r.Author.trim();
      const goodreadsId = r["Book Id"]?.trim() || undefined;
      const id = goodreadsId ? `gr${goodreadsId}` : `b${hashString(`${title}|${author}`).toString(36)}`;
      const rating = int(r["My Rating"]);

      return {
        id,
        kind: "book",
        title,
        series,
        author,
        year: int(r["Original Publication Year"]) ?? int(r["Year Published"]),
        pages: int(r["Number of Pages"]),
        format: r.Binding?.trim() || undefined,
        status: STATUS[r["Exclusive Shelf"]?.trim()] ?? "read",
        rating: rating ? rating : undefined,
        dateRead: date(r["Date Read"]),
        dateAdded: date(r["Date Added"]),
        review: review(r["My Review"]),
        tags: (r.Bookshelves ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s && !(s in STATUS)),
        subjects: [],
        category: "",
        isbn: isbn(r.ISBN13) ?? isbn(r.ISBN),
        goodreadsId,
        color: fallbackColor(id),
      };
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

/** Goodreads writes dates as YYYY/MM/DD. */
function date(s: string | undefined): string | undefined {
  const m = s?.trim().match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

/** Goodreads wraps ISBNs as ="0439023483" so spreadsheets keep leading zeros. */
function isbn(s: string | undefined): string | undefined {
  const v = s?.replace(/[^0-9X]/gi, "");
  return v || undefined;
}

function review(s: string | undefined): string | undefined {
  const text = s
    ?.replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .trim();
  return text || undefined;
}
