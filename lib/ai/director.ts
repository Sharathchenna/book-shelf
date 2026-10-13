import "server-only";
import { validCue, type Direction } from "../directions";
import { anthropic, HAIKU } from "./haiku";

/**
 * The narrator's director: Claude Haiku reads a run of a book's sentences and says how a few of
 * them should be delivered, as Fish Audio's voices understand it (lib/directions.ts). It
 * returns where each direction goes, never rewritten text, and what it returns is checked.
 */

const SYSTEM = `You direct an audiobook narrator, a text-to-speech voice reading a book aloud, one sentence at a time. You can give a sentence:
- cue: how to deliver it, in 1 to 4 plain lowercase words ("dry", "warm", "quietly tense", "eager", "whispering", "faintly amused", "grave"). It applies to the whole sentence.
- emphasis: a word or short phrase (1 to 4 words, copied exactly from the sentence) to stress.
- pause_before: a word or short phrase (copied exactly, not the sentence's first words) to pause just before, for a beat of suspense or a turn in thought.

Direct like a skilled human narrator: restraint first. Most sentences need nothing; leave them out. You'll be told the most you may direct; fewer is better. Save directions for the sentences where a listener would notice their absence, and usually give a sentence just one of the three.
- Fiction: cues on dialogue, matching the speaker's mood as the text shows it ("cried his wife impatiently": impatient). Narration stays even, with no cue, unless the scene turns sharply.
- Nonfiction (essays, history, science, business, memoir told plainly): no cues at all; the author's voice is even. Only emphasis, on the word that carries a claim or a contrast, and a rare pause before a reveal.
- A pause goes before one or two words, mid-sentence, at most once in a passage.
- Never cue laughter, crying, sighs or other sounds, and never shouting unless the text says someone shouts.
- Don't stress function words, or the same idea twice in a row.`;

const SCHEMA = {
  type: "object",
  properties: {
    directions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          cue: { type: "string" },
          emphasis: { type: "string" },
          pause_before: { type: "string" },
        },
        required: ["n", "cue", "emphasis", "pause_before"],
        additionalProperties: false,
      },
    },
  },
  required: ["directions"],
  additionalProperties: false,
};

export type Directable = {
  title: string;
  author: string;
  paper: boolean;
  /** The sentences to direct, as they'll be said. */
  sentences: string[];
  /** The few sentences before them, for context. */
  before: string[];
};

/** A direction for each sentence (null for none). */
export async function direct(input: Directable): Promise<(Direction | null)[]> {
  const lines = [
    `Book: ${input.title}${input.author ? ` by ${input.author}` : ""}${input.paper ? " (a research paper)" : ""}`,
    input.before.length && `Just before (context only, not to direct):\n${input.before.join(" ")}`,
    `Sentences, numbered. Direct at most ${Math.ceil(input.sentences.length / 5)} of them; list only those you direct:\n${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
  ].filter(Boolean);
  const message = await anthropic().messages.create(
    {
      model: HAIKU,
      max_tokens: 4000,
      system: SYSTEM,
      // No thinking: a listener is waiting for the first of these, and the judgement is a light one.
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: lines.join("\n\n") }],
    },
    { signal: AbortSignal.timeout(45_000) },
  );
  const out: (Direction | null)[] = input.sentences.map(() => null);
  if (message.stop_reason === "refusal") return out;
  const text = message.content.find((block) => block.type === "text")?.text;
  if (!text) return out;
  const { directions } = JSON.parse(text) as { directions: { n: number; cue: string; emphasis: string; pause_before: string }[] };
  // Past the limit, the rest are left out: a crowded chapter sounds like a trailer.
  for (const d of directions.slice(0, Math.ceil(input.sentences.length / 4))) {
    const say = input.sentences[d.n - 1];
    if (!say) continue;
    const cue = d.cue.trim().toLowerCase();
    // Phrases must really be in the sentence; a pause can't open it.
    const emphasis = d.emphasis.trim() && say.includes(d.emphasis.trim()) ? d.emphasis.trim() : undefined;
    const pause = d.pause_before.trim();
    const pauseBefore = pause && say.indexOf(pause) > 0 ? pause : undefined;
    const direction: Direction = { ...(cue && validCue(cue) ? { cue } : {}), ...(emphasis ? { emphasis } : {}), ...(pauseBefore ? { pauseBefore } : {}) };
    if (Object.keys(direction).length) out[d.n - 1] = direction;
  }
  return out;
}
