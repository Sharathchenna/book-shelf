/**
 * What can be done with a passage selected in the reader, beyond highlighting it: Claude Haiku
 * explains it, defines it, says it simply, checks it against the web, finds where else the text
 * takes it up, or argues against it. Shared by the selection popover and /api/reader/explain;
 * the prompts are in lib/ai/reader.ts. The set comes from Gloss.
 */

export type ReaderAction = "explain" | "define" | "simplify" | "check" | "connect" | "counter";

export const READER_ACTIONS: Record<ReaderAction, { label: string; hint: string }> = {
  explain: { label: "Explain", hint: "What it means here, and why it's here" },
  define: { label: "Define", hint: "The word, as this author uses it" },
  simplify: { label: "Simplify", hint: "The same idea in plain words" },
  check: { label: "Fact-check", hint: "Does it still hold up? Searches the web" },
  connect: { label: "Related", hint: "Where else the text takes this up" },
  counter: { label: "Counterpoint", hint: "The strongest objection to it" },
};

export const isReaderAction = (v: unknown): v is ReaderAction => typeof v === "string" && v in READER_ACTIONS;

/** Short selections get Define; longer ones get Simplify in the same place. */
export const isShortSelection = (text: string) => text.trim().split(/\s+/).length <= 4;

/** The actions offered under "More", for a selection of this length. */
export const moreActions = (text: string): ReaderAction[] => [isShortSelection(text) ? "define" : "simplify", "check", "connect", "counter"];
