import "server-only";
import { clipId, clipLink, expand, type ClipOptions } from "./clip";
import { getClipping, getClippings, getShelf, saveClipping } from "./data";
import { enrich } from "./enrich";
import { bookDoc, clipDoc } from "./search/site";
import { indexDocs } from "./search/vectors";
import type { Clip } from "./types";

/**
 * Saving a link, however it arrives (Add on the site, the phone shortcut, the bookmarklet):
 * describe it, work out what it's about, store it, and put it in the search index.
 */
export async function saveLink(input: string, options: ClipOptions): Promise<{ clip: Clip; refreshed: boolean }> {
  let existing: Clip | null = null;
  try {
    existing = await getClipping(clipId(expand(input.trim())));
  } catch {
    // Not a parseable URL; clipLink explains.
  }
  const clip = await clipLink(input, options, existing);
  const enriched = await enrich(clip).catch((error) => {
    console.error("Enrichment failed", clip.id, error);
    return undefined;
  });
  // A refresh whose enrichment failed keeps the one it had.
  if (enriched ?? existing?.enriched) clip.enriched = enriched ?? existing?.enriched;
  await saveClipping(clip);
  await indexDocs([clipDoc(clip)]).catch((error) => console.error("Indexing failed", clip.id, error));
  return { clip, refreshed: Boolean(existing) };
}

/** Clippings saved before enrichment existed get it a few at a time, so one run stays short. */
const ENRICH_PER_RUN = 8;

/**
 * Keeps search complete: enriches a few older clippings that lack it, then embeds whatever
 * changed and drops what's gone. Runs after every Goodreads sync (nightly, and the Sync button).
 */
export async function refreshSearch(): Promise<{ enriched: number; embedded: number; removed: number } | null> {
  const [shelf, { items: clips }] = await Promise.all([getShelf(), getClippings()]);
  let enriched = 0;
  for (const clip of clips.filter((c) => c.kind !== "paper" && !c.enriched).slice(0, ENRICH_PER_RUN)) {
    const found = await enrich(clip).catch(() => undefined);
    if (!found) continue;
    clip.enriched = found;
    await saveClipping(clip);
    enriched++;
  }
  const indexed = await indexDocs([...shelf.items.map(bookDoc), ...clips.map(clipDoc)], { prune: true });
  return indexed && { enriched, ...indexed };
}
