import { bookCard } from "../ai/jev";
import { CLIP_LABEL } from "../clippings";
import { STATUS_LABEL } from "../shelf";
import type { Clip, Item } from "../types";
import { searchText } from "./bm25";

/** One searchable thing on the site, with what the search palette shows for it. */
export type SearchDoc = {
  id: string;
  kind: "book" | Clip["kind"];
  title: string;
  subtitle: string;
  image?: string;
  /** Where it opens: a book's card, or the clipping's source. */
  href: string;
  /** A paper the owner can read here (the palette opens it in the reader for them). */
  paperId?: string;
  /** An X Article the owner can read here, likewise. */
  articleId?: string;
  /** For Jev: what it is and what it's about. */
  card: string;
  /** For BM25. */
  text: string;
  /** For the embedding: everything known about it, longer than the card. */
  passage: string;
};

export function bookDoc(item: Item): SearchDoc {
  return {
    id: `book:${item.id}`,
    kind: "book",
    title: item.title,
    subtitle: [item.author, STATUS_LABEL[item.status], item.rating ? "★".repeat(item.rating) : ""].filter(Boolean).join(" · "),
    image: item.cover,
    href: `/?book=${encodeURIComponent(item.id)}`,
    card: `A book. ${bookCard(item)}`,
    text: searchText(item),
    passage: `A book. ${bookCard(item)}`,
  };
}

export function clipDoc(clip: Clip): SearchDoc {
  const kind = CLIP_LABEL[clip.kind].replace(/s$/, "").toLowerCase();
  const title = clip.title ?? (clip.tweet ? `@${clip.tweet.handle}: ${clip.tweet.text.replace(/\s+/g, " ").slice(0, 90)}` : clip.url);
  const by = clip.tweet ? `@${clip.tweet.handle}` : clip.paper?.authors.length ? clip.paper.authors.slice(0, 3).join(", ") : clip.author;
  const about = clip.tweet?.text ?? clip.excerpt ?? "";
  const post = clip.tweet;
  const found = clip.enriched;
  const context = [
    post?.replyTo && `In reply to @${post.replyTo.handle}: ${post.replyTo.text}`,
    post?.quote && `Quoting @${post.quote.handle}: ${post.quote.text}`,
  ].filter(Boolean) as string[];
  const described = [
    found?.summary && `In short: ${found.summary}`,
    found?.topics.length && `Topics: ${found.topics.join(", ")}.`,
    found?.images?.length && `Images: ${found.images.join(" ")}`,
    found?.link && `Links to ${found.link.title ? `"${found.link.title}"` : found.link.url}.`,
  ].filter(Boolean) as string[];
  return {
    id: `clip:${clip.id}`,
    kind: clip.kind,
    title,
    subtitle: [by, clip.source, clip.paper?.year ?? clip.published?.slice(0, 4)].filter(Boolean).join(" · "),
    image: clip.image ?? clip.tweet?.avatar,
    href: clip.url,
    paperId: clip.paper?.pdf ? clip.id : undefined,
    articleId: clip.xArticle ? clip.id : undefined,
    card: [
      `A ${kind}: ${title}${by ? ` by ${by}` : ""} (${clip.source}).`,
      about.slice(0, 500),
      ...context.map((c) => c.slice(0, 240)),
      ...described.map((d) => d.slice(0, 400)),
      clip.tags.length ? `Tags: ${clip.tags.join(", ")}.` : "",
      clip.note ? `The reader's note: ${clip.note.slice(0, 200)}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    text: [title, by, clip.source, about, ...context, ...described, ...clip.tags, clip.note, clip.paper?.authors.join(" ")]
      .filter(Boolean)
      .join(" "),
    passage: [
      `A ${kind}: ${title}${by ? ` by ${by}` : ""} (${clip.source}).`,
      about,
      ...context,
      ...described,
      found?.link?.text,
      clip.tags.length ? `Tags: ${clip.tags.join(", ")}.` : "",
      clip.note && `The reader's note: ${clip.note}`,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 8000),
  };
}
