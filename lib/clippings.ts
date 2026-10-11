import data from "@/data/clippings.json";
import type { ClipKind, ClippingsData } from "./types";

/** Maintained with `bun run clip <url>`. */
export const clippings = data as ClippingsData;

/** Page order of the clipping sections. */
export const CLIP_KINDS: ClipKind[] = ["article", "newsletter", "tweet"];

export const CLIP_LABEL: Record<ClipKind, string> = {
  article: "Articles",
  newsletter: "Newsletters",
  tweet: "Tweets",
};
