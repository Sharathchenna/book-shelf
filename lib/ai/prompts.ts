import "server-only";
import type { Item } from "../types";
import { bookCard, type Ranked } from "./jev";

/** System prompt for the answer above search results. */
export function answerSystem(owner: string): string {
  return `You write the short answer that appears above search results on ${owner}'s personal bookshelf website. A visitor asked the shelf a question, and a ranking model has already chosen the best-matching books from ${owner}'s shelf.

Write 2 to 4 sentences (under 90 words) telling the visitor where to start and why, using the books' details and ${owner}'s own ratings and notes when they help. Talk about ${owner} in the third person, by name or with they/them; never guess pronouns.

Refer to a book only by its id in double square brackets, like [[gr12345]]. The site turns each one into a link showing the title, so never also write the title. Only mention books from the list you are given. If the matches are weak, say so plainly and point to the closest one. Plain sentences only: no markdown, headings or lists.`;
}

export function answerPrompt(question: string, ranked: Ranked[], byId: Map<string, Item>): string {
  const lines = ranked.map(({ id, match }) => {
    const item = byId.get(id);
    return item ? `[[${id}]] (match ${Math.round(match * 100)}%)\n${bookCard(item)}` : "";
  });
  return `Visitor's question: ${question}\n\nBest matches, strongest first:\n\n${lines.filter(Boolean).join("\n\n")}`;
}

/** For "Pick my next read": the books that best describe the reader's taste. */
export function tasteContext(items: Item[]): string {
  const loved = items
    .filter((i) => i.rating === 5)
    .toSorted((a, b) => (b.dateRead ?? "").localeCompare(a.dateRead ?? ""))
    .slice(0, 25)
    .map((i) => `${i.title} by ${i.author} (${i.category})`);
  return loved.length ? `Books the reader rated five stars: ${loved.join("; ")}.` : "";
}
