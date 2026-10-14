import "server-only";
import type { Brief } from "../brief-types";
import type { LibraryBook } from "../library-types";
import { anthropic, HAIKU } from "./haiku";
import { byline } from "./reader";

/**
 * The brief on a paper or article: what it argues, its load-bearing claims, and what a careful
 * reader should keep in mind before relying on it, each pointing at the section that shows it.
 * A reader takes it as a verdict on the text, so it reports what the evidence shows rather than
 * the text's own headline: a paper's abstract can round its results one way and its tables
 * another. The rules are Gloss's.
 */

/** About 150k tokens; a longer text keeps its start, where the argument and results are. */
const MAX_CHARS = 600_000;

const SYSTEM = `You write the brief a careful reader sees before reading a text closely: a research paper or an article. The text's sections are numbered [§n].

Return:
- gist: two sentences: what this text argues and why it matters. It claims no more than the claims do.
- claims: 3 to 5, each one sentence, with "section": the number of the single section that best supports it. Together they carry the text's load-bearing ideas in its own order: what it argues and how it gets there, then what its evidence shows. No more than two claims are results.
- caveats: 1 to 3, each one sentence, with "section": the section that shows it, or 0 when it is about something the text leaves out. What a careful reader should keep in mind before relying on this text: the limits of its scope (which data, models, settings, people or cases it covers, and what it never tests), its standing (a preprint not yet peer reviewed, an opinion piece, a single study), what the author concedes, and any place its headline goes beyond its own evidence. Each caveat must be true of this text. An empty list only when nothing applies.

Rules:
- Numbers come from the text's evidence (its tables and data), never from a sentence that sums them up (an abstract, introduction, conclusion, or prose that restates a table). Check every summary figure against the table it summarizes before you repeat it: when they disagree, use what the table shows and add a caveat that the summary says otherwise. Prefer figures the table reports outright, like "89.8% against 92.3%", over averages or ranges you would have to work out.
- Make every comparison exactly as strong as the evidence. Give the numbers instead of words like "matches", "approaches" or "outperforms", and say where it falls short or loses.
- Plain sentences. Write math in plain text or simple Unicode, not LaTeX. Never use em dashes or en dashes.`;

const POINT = {
  type: "object",
  properties: { text: { type: "string" }, section: { type: "integer" } },
  required: ["text", "section"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: { gist: { type: "string" }, claims: { type: "array", items: POINT }, caveats: { type: "array", items: POINT } },
  required: ["gist", "claims", "caveats"],
  additionalProperties: false,
};

/** The brief, or null when Haiku declined. `sections` is the text of each of the book's sections. */
export async function writeBrief(book: LibraryBook, sections: string[]): Promise<Brief | null> {
  let body = "";
  for (const [i, text] of sections.entries()) {
    if (!text.trim()) continue;
    const part = `[§${i + 1}] ${book.sections[i]?.title ?? ""}\n${text.trim()}\n\n`;
    if (body.length + part.length > MAX_CHARS) break;
    body += part;
  }
  const kind = book.paperId ? "A research paper" : "An article";
  const message = await anthropic()
    .messages.stream({
      model: HAIKU,
      max_tokens: 16000,
      // The checking takes some thought: summary figures against tables.
      thinking: { type: "adaptive" },
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content: `${kind}: ${byline(book)}\n\n<text>\n${body}</text>` }],
    })
    .finalMessage();
  const text = message.content.find((block) => block.type === "text")?.text;
  if (message.stop_reason === "refusal" || !text) return null;
  const raw = JSON.parse(text) as { gist: string; claims: { text: string; section: number }[]; caveats: { text: string; section: number }[] };
  // Back to the reader's 0-based sections; a number that isn't one of them points nowhere.
  const at = (n: number) => (Number.isInteger(n) && n >= 1 && n <= sections.length ? n - 1 : undefined);
  const point = (p: { text: string; section: number }) => ({ text: p.text.trim(), ...(at(p.section) !== undefined ? { section: at(p.section) } : {}) });
  return { gist: raw.gist.trim(), claims: raw.claims.slice(0, 5).map(point), caveats: raw.caveats.slice(0, 3).map(point) };
}
