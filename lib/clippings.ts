import type { Clip, ClipKind } from "./types";

// Labels and paths for the kinds of clipping; the clippings themselves come from lib/data.ts (D1).

/** Page order of the clipping sections. */
export const CLIP_KINDS: ClipKind[] = ["article", "paper", "newsletter", "tweet"];

export const CLIP_LABEL: Record<ClipKind, string> = {
  article: "Articles",
  paper: "Papers",
  newsletter: "Newsletters",
  tweet: "Tweets",
  // Read in the app (lib/media.ts); the site has no page of them yet.
  video: "Videos",
  podcast: "Podcasts",
};

/** `present` (kinds with at least one clipping) in page order. Kinds without any get no page or link. */
export const inPageOrder = (present: ClipKind[]) => CLIP_KINDS.filter((kind) => present.includes(kind));

export const clipPath = (kind: ClipKind) => `/${CLIP_LABEL[kind].toLowerCase()}`;

/** Clippings the owner reads in the reader as an ebook: X Articles, articles and newsletter issues from anywhere, and videos and episodes (their transcripts). */
export const readableClip = (clip: Pick<Clip, "kind" | "xArticle">) =>
  Boolean(clip.xArticle) || clip.kind === "article" || clip.kind === "newsletter" || clip.kind === "video" || clip.kind === "podcast";
