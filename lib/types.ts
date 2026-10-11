export type ItemKind = "book";
export type Status = "read" | "reading" | "to-read";

export type Item = {
  id: string;
  kind: ItemKind;
  title: string;
  series?: string;
  author: string;
  year?: number;
  pages?: number;
  format?: string;
  status: Status;
  /** 1–5, absent when unrated. */
  rating?: number;
  /** ISO date (YYYY-MM-DD). */
  dateRead?: string;
  dateAdded?: string;
  review?: string;
  /** The reader's own Goodreads shelves, minus the status shelves. */
  tags: string[];
  /** Topic subjects from Open Library. */
  subjects: string[];
  category: string;
  isbn?: string;
  goodreadsId?: string;
  openLibraryKey?: string;
  cover?: string;
  /** Dominant cover colour, or a stable fallback; used for spines and generated covers. */
  color: string;
  description?: string;
};

export type ShelfData = {
  updatedAt: string;
  items: Item[];
};

export type ClipKind = "article" | "paper" | "newsletter" | "tweet";

/** Something read on the web: an article, a paper, a newsletter issue or a post. Added with `bun run clip <url>`. */
export type Clip = {
  id: string;
  kind: ClipKind;
  url: string;
  /** Absent for tweets, whose text is the content. */
  title?: string;
  author?: string;
  /** Site, publication, journal or conference (papers), or "X" (tweets). */
  source: string;
  /** Summary; a paper's abstract. */
  excerpt?: string;
  image?: string;
  /** ISO date the piece was published. */
  published?: string;
  /** ISO date it was added to the shelf. */
  saved: string;
  minutes?: number;
  /** The reader's own note on it. */
  note?: string;
  tags: string[];
  paper?: {
    authors: string[];
    year?: number;
    /** arXiv id without its version, e.g. "1706.03762". */
    arxiv?: string;
    doi?: string;
    /** A PDF anyone can read (arXiv, open proceedings). */
    pdf?: string;
  };
  tweet?: {
    name: string;
    handle: string;
    avatar?: string;
    text: string;
    media: string[];
    likes?: number;
  };
};

export type ClippingsData = { items: Clip[] };
