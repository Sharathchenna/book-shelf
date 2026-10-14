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

/** Something read on the web: an article, a paper, a newsletter issue or a post. Added with the site's Add button. */
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
  /** How it was saved, when not with Add on the site: the phone shortcut, or an agent (/mcp). */
  via?: "phone" | "agent";
  tags: string[];
  paper?: {
    authors: string[];
    year?: number;
    /** arXiv id without its version, e.g. "1706.03762". */
    arxiv?: string;
    doi?: string;
    /** A PDF anyone can read (arXiv, open proceedings). */
    pdf?: string;
    /** From Papers with Code (lib/pwc.ts), for arXiv papers it knows. */
    pwc?: PaperCode;
  };
  tweet?: {
    name: string;
    handle: string;
    avatar?: string;
    text: string;
    /** Photos, and the poster frames of videos. */
    media: string[];
    likes?: number;
    /** The post it quotes. */
    quote?: QuotedPost;
    /** The post it replies to. */
    replyTo?: QuotedPost;
  };
  /** An X Article (a long post with a title): the owner reads it in the site's reader (lib/x-article.ts). */
  xArticle?: { handle: string; avatar?: string };
  /** Added when it's saved (lib/enrich.ts), so search finds it by what it's about. */
  enriched?: Enrichment;
};

/** A paper's code and where it stands in its field, from Papers with Code. */
export type PaperCode = {
  /** Two sentences on what it does and what it found. */
  tldr?: string;
  /** The official implementation, else the most starred. */
  repo?: { url: string; name: string; stars?: number; official: boolean };
  project?: string;
  tasks: { name: string; slug: string }[];
  /** Its best leaderboard places (top three only). */
  sota?: { benchmark: string; rank: number; metric: string }[];
  citations?: number;
  /** ISO date it was last looked up; stars and citations change. */
  checked: string;
};

export type QuotedPost = { name: string; handle: string; text: string; url: string; media?: string[] };

export type Enrichment = {
  /** One line on what it is and why it's worth keeping. */
  summary: string;
  /** A few lowercase topics. */
  topics: string[];
  /** What each image shows, including any text or numbers in it (for posts with photos). */
  images?: string[];
  /** The page a post links to: its title and the start of its text. */
  link?: { url: string; title?: string; text: string };
  /** ISO time. */
  at: string;
};

export type ClippingsData = { items: Clip[] };
