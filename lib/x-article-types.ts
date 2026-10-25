/**
 * An article to make an ebook of: an X Article (a long post with a title, headings and
 * pictures) as X's editor content (Draft.js blocks) with its pictures and the posts it embeds
 * resolved, or any other clipped article in the same blocks (lib/web-article.ts). Shared by the
 * server, which fetches it (lib/x-article.ts, lib/web-article.ts), and the reader, which makes
 * an ebook of it (app/components/reader/x-article-epub.ts).
 */

export type XArticleBlock = {
  /** Draft.js block type: unstyled, header-one/two/three, blockquote, ordered/unordered-list-item, code-block, atomic. */
  type: string;
  text: string;
  /** Nesting, for list items. */
  depth: number;
  /** Bold, Italic, Strikethrough, Code; offsets and lengths in UTF-16 units, as in `text`. */
  styles: { offset: number; length: number; style: string }[];
  links: { offset: number; length: number; url: string }[];
  /**
   * Equations in the text (web articles): the range holds the equation's TeX (or its words), for
   * search and quotes, and the page shows it as MathML, made from the TeX when the page had no
   * MathML of its own.
   */
  maths?: ArticleMath[];
  /** What an atomic block holds. */
  media?: { src: string; width?: number; height?: number }[];
  post?: XArticlePost;
  code?: string;
  /** The code's language, as the page named it (`js`, `python`). */
  lang?: string;
  divider?: boolean;
  /** A data table's rows, each cell with its own bold, italic and links (web articles). */
  table?: { head: boolean; cells: Pick<XArticleBlock, "text" | "styles" | "links">[] }[];
  /** A video file, played from where the page has it. */
  video?: ArticleVideo;
  /** An audio file, played from where the page has it. */
  audio?: { src: string };
  /** A player from another site, in place (YouTube, Vimeo, Spotify…), or a link to an interactive one. */
  embed?: ArticleEmbed;
};

export type ArticleMath = { offset: number; length: number; display: boolean; mathml?: string; tex?: string };

export type ArticleVideo = {
  src: string;
  poster?: string;
  width?: number;
  height?: number;
  /** A clip that plays by itself, silent and on a loop, as a GIF would: so it does in the ebook. */
  loop?: boolean;
};

export type ArticleEmbed = {
  /** The player the page embedded. `interactive` is a chart, notebook or sandbox, linked rather than shown. */
  kind: "youtube" | "vimeo" | "loom" | "spotify" | "apple" | "soundcloud" | "interactive";
  /** The player's address, set to play in the ebook. */
  player: string;
  /** Where to watch or listen to it on its own site. */
  url: string;
  title?: string;
  /** Its height in CSS px, for an audio player; videos are 16:9 unless the page said otherwise. */
  height?: number;
  aspect?: number;
};

export type ArticleBlock = XArticleBlock;

/** A post the article embeds. */
export type XArticlePost = {
  url: string;
  name?: string;
  handle?: string;
  text?: string;
  /** ISO date. */
  date?: string;
  /** Its pictures, and its videos as their stills with the file to play. */
  media?: { src: string; video?: string; loop?: boolean; width?: number; height?: number }[];
};

export type XArticle = {
  /** The post an X Article was published as, or a web article's clipping id. */
  id: string;
  url: string;
  title: string;
  preview: string;
  cover?: string;
  /** ISO date. */
  published?: string;
  /** `handle` on X. */
  author: { name: string; handle?: string; avatar?: string };
  /** A web article's site or publication. */
  site?: string;
  blocks: XArticleBlock[];
};

/** About how long it takes to read, at the pace the site uses for articles. */
export function articleMinutes(article: Pick<XArticle, "blocks">): number {
  const words = article.blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
  return Math.max(1, Math.round(words / 230));
}
