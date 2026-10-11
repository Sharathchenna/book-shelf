import "server-only";
import { TypeSafeClient, type NoulQuestion } from "@typesafe-ai/sdk";
import type { Item } from "../types";

/** Books per request, and requests in flight at once. No documented per-request limit; kept modest. */
const BATCH = 25;
const CONCURRENCY = 4;

let client: TypeSafeClient | undefined;

export const jevEnabled = () => Boolean(process.env.TYPESAFE_API_KEY);

function jev(): TypeSafeClient {
  client ??= new TypeSafeClient({ timeout: 20_000 });
  return client;
}

/** A short description of a book for Jev to judge. */
export function bookCard(item: Item): string {
  return [
    `${item.title}${item.series ? ` (${item.series})` : ""} by ${item.author}`,
    [item.category, item.year && `published ${item.year}`, item.pages && `${item.pages} pages`]
      .filter(Boolean)
      .join(", "),
    item.subjects.length ? `Subjects: ${item.subjects.slice(0, 8).join("; ")}` : "",
    item.description ? `About: ${item.description.slice(0, 360)}` : "",
    item.rating ? `The reader rated it ${item.rating}/5.` : "",
    item.status === "to-read" ? "Not read yet." : item.status === "reading" ? "Currently reading." : "",
    item.review ? `The reader's note: ${item.review.slice(0, 200)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export type Ranked = { id: string; match: number };

type RankOptions = {
  /** What the reader asked, in their words. */
  request: string;
  /** Extra context Jev can cite, e.g. the reader's favourite books. */
  context?: string;
  /** Overrides the default "does this book fit the request" question. */
  instructions?: string;
};

/**
 * Ranks books against a request with one Jev "noul" (yes/no probability) per book,
 * the pattern TypeSafe documents for re-ranking. The probability is the % match.
 */
export async function rankWithJev(items: Item[], options: RankOptions): Promise<Ranked[]> {
  const batches: Item[][] = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));

  const question = (key: string): NoulQuestion => ({
    type: "noul",
    instructions:
      options.instructions?.replace("{book}", `\`books.${key}\``) ??
      `Does the book \`books.${key}\` fit what the reader is asking for in \`request\`?`,
    criteria: {
      true: "The book clearly fits: its subject, mood, genre, plot or the reader's own notes match the request.",
      false: "The book does not fit, or only shares a word or surface topic with the request.",
    },
  });

  const results: Ranked[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const batch = batches[next++];
        // Question keys are opaque to the model; short positional keys keep the books map readable.
        const keys = batch.map((_, i) => `b${i}`);
        const response = await jev().systemOne({
          state: {
            request: options.request,
            ...(options.context ? { reader_context: options.context } : {}),
            books: Object.fromEntries(batch.map((item, i) => [keys[i], bookCard(item)])),
          },
          questions: Object.fromEntries(keys.map((key) => [key, question(key)])),
        });
        batch.forEach((item, i) => {
          const answer = response.answers[keys[i]];
          results.push({ id: item.id, match: answer && "noul" in answer ? answer.noul : 0 });
        });
      }
    }),
  );

  return results.sort((a, b) => b.match - a.match);
}
