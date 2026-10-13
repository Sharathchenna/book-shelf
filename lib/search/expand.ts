import "server-only";
import { anthropic, HAIKU, haikuEnabled } from "../ai/haiku";

/**
 * Keyword search finds only the words it's given, so before narrowing a large collection by
 * keywords, Claude Haiku lists words the things being looked for are likely to contain:
 * synonyms, the field's own terms, well-known works, people, tools and methods. "Papers on
 * making LLMs answer faster" becomes "speculative decoding", "inference latency", "kv cache"…
 * BM25 then weighs them below the reader's own words (lib/search/bm25.ts). Best effort: without
 * a key, or when Haiku is slow or fails, the search goes on with its own words.
 */

const SYSTEM = `You help a keyword search over one person's reading collection: books (with descriptions and subjects), research papers (titles and abstracts), articles, newsletter issues and posts on X.

Given what they typed, list words and short phrases that the things they're looking for are likely to contain, but that they didn't type: synonyms, the field's own terms, well-known titles, authors, people, tools, methods and named ideas. Prefer specific terms over generic ones. Lowercase, at most 12, none repeating their words.`;

const SCHEMA = {
  type: "object",
  properties: { terms: { type: "array", items: { type: "string" } } },
  required: ["terms"],
  additionalProperties: false,
};

const MAX_TERMS = 12;
/** A search shouldn't wait longer than this for its extra words. */
const TIMEOUT_MS = 4000;
const cache = new Map<string, string[]>();

/** Related words for a search, or an empty list. */
export async function relatedTerms(query: string): Promise<string[]> {
  if (!haikuEnabled()) return [];
  const key = query.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const message = await anthropic().messages.create(
      {
        model: HAIKU,
        max_tokens: 300,
        system: SYSTEM,
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{ role: "user", content: query.slice(0, 300) }],
      },
      { signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (message.stop_reason === "refusal") return [];
    const text = message.content.find((block) => block.type === "text")?.text;
    const { terms } = text ? (JSON.parse(text) as { terms: string[] }) : { terms: [] };
    const found = [...new Set(terms.map((t) => t.trim().toLowerCase().slice(0, 60)).filter(Boolean))].slice(0, MAX_TERMS);
    cache.set(key, found);
    if (cache.size > 500) cache.delete(cache.keys().next().value!);
    return found;
  } catch (error) {
    console.error("Query expansion failed", error);
    return [];
  }
}
