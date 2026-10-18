/**
 * Where a highlight is, in a form both readers can find: the text itself, a little of what comes
 * before and after it, and how far into its section it starts. The web reader also keeps foliate's
 * CFI; the Android app (Readium) finds highlights by their quote, and the web reader turns a
 * quote-only highlight from the app into a CFI the first time it opens the section.
 *
 * Whitespace is collapsed before comparing, since the two readers see a section's text through
 * different DOMs. No React and no server code: the reader imports it.
 */

/** Characters of context kept on each side. */
export const QUOTE_CONTEXT = 32;

export type Quote = { before: string; after: string };

const squash = (s: string) => s.replace(/\s+/g, " ");

/** The text just before and after a range, within its document's body. */
export function quoteAround(range: Range): Quote {
  const doc = range.startContainer.ownerDocument;
  if (!doc?.body) return { before: "", after: "" };
  const head = doc.createRange();
  head.setStart(doc.body, 0);
  head.setEnd(range.startContainer, range.startOffset);
  const tail = doc.createRange();
  tail.setStart(range.endContainer, range.endOffset);
  tail.setEndAfter(doc.body.lastChild ?? doc.body);
  return {
    before: squash(head.toString()).slice(-QUOTE_CONTEXT).trimStart(),
    after: squash(tail.toString()).slice(0, QUOTE_CONTEXT).trimEnd(),
  };
}

/**
 * The range a quote points at in a section's document, or null when the text isn't there. When
 * the text appears more than once, the copy whose surroundings match best wins, then the one
 * nearest `progression` (0–1 through the section).
 */
export function findQuote(doc: Document, text: string, quote?: Quote, progression?: number): Range | null {
  if (!doc.body || !text.trim()) return null;
  // The section's text with whitespace collapsed, and where each of its characters came from.
  const nodes: Text[] = [];
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  let flat = "";
  const from: [number, number][] = [];
  let space = false;
  nodes.forEach((node, i) => {
    const value = node.data;
    for (let o = 0; o < value.length; o++) {
      const blank = /\s/.test(value[o]);
      if (blank && space) continue;
      space = blank;
      flat += blank ? " " : value[o];
      from.push([i, o]);
    }
  });

  const needle = squash(text).trim();
  const before = squash(quote?.before ?? "");
  const after = squash(quote?.after ?? "");
  let best: { at: number; score: number } | null = null;
  for (let at = flat.indexOf(needle); at !== -1; at = flat.indexOf(needle, at + 1)) {
    let score = 0;
    for (let k = 1; k <= before.length && flat[at - k] === before[before.length - k]; k++) score++;
    for (let k = 0; k < after.length && flat[at + needle.length + k] === after[k]; k++) score++;
    // Context counts most; position breaks ties.
    if (progression !== undefined && flat.length) score -= Math.abs(at / flat.length - progression);
    if (!best || score > best.score) best = { at, score };
  }
  if (!best) return null;

  const [startNode, startOffset] = from[best.at];
  const [endNode, endOffset] = from[best.at + needle.length - 1];
  const range = doc.createRange();
  range.setStart(nodes[startNode], startOffset);
  range.setEnd(nodes[endNode], endOffset + 1);
  return range;
}

/** Whether a highlight's place is a CFI the web reader can draw (rather than a quote-only one from the app). */
export const hasCfi = (cfi: string) => cfi.startsWith("epubcfi(") || cfi.startsWith("page:");

/**
 * A highlight's quote and progression from its section's plain text (what the server keeps for
 * the AI), for highlights made before they were recorded. Null when the text isn't found.
 */
export function quoteInText(section: string, text: string): { quote: Quote; progression: number } | null {
  const flat = squash(section);
  const needle = squash(text).trim();
  const at = needle ? flat.indexOf(needle) : -1;
  if (at === -1) return null;
  return {
    quote: { before: flat.slice(Math.max(0, at - QUOTE_CONTEXT), at).trimStart(), after: flat.slice(at + needle.length, at + needle.length + QUOTE_CONTEXT).trimEnd() },
    progression: flat.length ? Math.round((at / flat.length) * 1e4) / 1e4 : 0,
  };
}
