import data from "@/data/clippings.json";
import type { ClipKind, ClippingsData } from "./types";

/** Maintained with `bun run clip <url>`. */
export const clippings = data as ClippingsData;

/** Page order of the clipping sections. */
export const CLIP_KINDS: ClipKind[] = ["article", "paper", "newsletter", "tweet"];

export const CLIP_LABEL: Record<ClipKind, string> = {
  article: "Articles",
  paper: "Papers",
  newsletter: "Newsletters",
  tweet: "Tweets",
};

/** Kinds that have at least one clipping, in page order. Kinds without any get no page or link. */
export const clipKindsPresent = () => CLIP_KINDS.filter((kind) => clippings.items.some((c) => c.kind === kind));

export const clipPath = (kind: ClipKind) => `/${CLIP_LABEL[kind].toLowerCase()}`;
