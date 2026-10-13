/**
 * An X Article (a long post with a title, headings and pictures), as the site keeps it: X's
 * editor content (Draft.js blocks) with its pictures and the posts it embeds resolved. Shared by
 * the server, which fetches it (lib/x-article.ts), and the reader, which makes an ebook of it
 * (app/components/reader/x-article-epub.ts).
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
  /** What an atomic block holds. */
  media?: { src: string; width?: number; height?: number }[];
  post?: XArticlePost;
  code?: string;
  divider?: boolean;
};

/** A post the article embeds. */
export type XArticlePost = { url: string; name?: string; handle?: string; text?: string };

export type XArticle = {
  /** The post the article was published as. */
  tweetId: string;
  url: string;
  title: string;
  preview: string;
  cover?: string;
  /** ISO date. */
  published?: string;
  author: { name: string; handle: string; avatar?: string };
  blocks: XArticleBlock[];
};

/** About how long it takes to read, at the pace the site uses for articles. */
export function articleMinutes(article: Pick<XArticle, "blocks">): number {
  const words = article.blocks.reduce((n, b) => n + (b.text.match(/\S+/g)?.length ?? 0), 0);
  return Math.max(1, Math.round(words / 230));
}
