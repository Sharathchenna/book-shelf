import "server-only";
import { cleanTags, TOPICS, topicOf, type Shelving } from "../bookcase";
import { anthropic, HAIKU } from "./haiku";

/**
 * Shelving books and clippings onto the bookcase's topics: Claude Haiku reads what each one is
 * (its title, author and what's known about it) and picks the one topic that fits best, with a
 * few tags more specific than the topic. Many at a time, so a whole shelf costs a single call.
 */

const SYSTEM = `You shelve a reader's books and saved reading (papers, articles, posts) in their personal library.

For each item, pick the one topic that fits best, by its key:
${TOPICS.filter((t) => t.key !== "unsorted")
  .map((t) => `- ${t.key}: ${t.hint}`)
  .join("\n")}

Then up to 3 tags: short lowercase words or phrases that say what it is about, more specific than the topic (e.g. "speculative decoding", "hiring", "stoicism", "semiconductors").

Shelve by what the item is mostly about, not by where it was published or its format. A biography goes under the field its subject is known for when that field is the point (a founder's life under tech or startups); otherwise under history.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          topic: { type: "string", enum: TOPICS.filter((t) => t.key !== "unsorted").map((t) => t.key) },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["id", "topic", "tags"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

/** One item to shelve: its id and a few lines saying what it is. */
export type Shelvable = { id: string; about: string };

/** Up to this many items a call. */
export const SHELVE_BATCH = 30;

/** A topic and tags for each item Haiku placed, by id. */
export async function shelve(items: Shelvable[]): Promise<Map<string, Shelving>> {
  const message = await anthropic().messages.create(
    {
      model: HAIKU,
      max_tokens: 4000,
      system: SYSTEM,
      thinking: { type: "disabled" },
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content: items.map((item) => `<item id="${item.id}">\n${item.about}\n</item>`).join("\n\n") }],
    },
    { signal: AbortSignal.timeout(60_000) },
  );
  const out = new Map<string, Shelving>();
  const text = message.content.find((block) => block.type === "text")?.text;
  if (message.stop_reason === "refusal" || !text) return out;
  const wanted = new Set(items.map((item) => item.id));
  for (const placed of (JSON.parse(text) as { items: { id: string; topic: string; tags: string[] }[] }).items) {
    if (!wanted.has(placed.id)) continue;
    const topic = topicOf(placed.topic);
    if (topic !== "unsorted") out.set(placed.id, { topic, tags: cleanTags(placed.tags, topic) });
  }
  return out;
}
