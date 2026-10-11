import "server-only";
import { keys, readIndex, validId } from "../library";
import type { LibraryBook } from "../library-types";
import { getJson } from "../storage";

/**
 * Text the reader has already read: every earlier section, plus the current one up to their
 * position. Nothing after the position is ever sent to the model, which is what keeps
 * explanations and recaps spoiler-free.
 */
export async function textSoFar(
  bookId: string,
  sectionIndex: number,
  /** How far through the current section, 0–1. */
  sectionFraction: number,
  maxChars: number,
): Promise<{ book: LibraryBook; text: string; truncated: boolean } | null> {
  if (!validId(bookId)) return null;
  const book = (await readIndex()).find((b) => b.id === bookId);
  const sections = await getJson<string[]>(keys.text(bookId));
  if (!book || !sections) return null;

  const index = Math.min(Math.max(0, Math.floor(sectionIndex)), sections.length - 1);
  const parts = sections.slice(0, index).map((text, i) => (text ? `## ${book.sections[i]?.title ?? ""}\n\n${text}` : ""));
  const current = sections[index] ?? "";
  const cut = Math.round(current.length * Math.min(1, Math.max(0, sectionFraction)));
  parts.push(`## ${book.sections[index]?.title ?? ""}\n\n${current.slice(0, cut)}`);

  const text = parts.filter(Boolean).join("\n\n");
  // Very long books: keep the most recent text, which matters most for "previously".
  return text.length > maxChars
    ? { book, text: `[Earlier chapters omitted]\n\n${text.slice(-maxChars)}`, truncated: true }
    : { book, text, truncated: false };
}

/** "Title by Author", or just the title when the file didn't say (common for PDFs). */
export const byline = (book: Pick<LibraryBook, "title" | "author">) => (book.author ? `${book.title} by ${book.author}` : book.title);

export const EXPLAIN_SYSTEM = `You help someone reading a book. They selected a passage and asked what it means.

Explain it briefly (under 120 words): what is happening or being said, plus anything that makes it hard to follow, such as an old or unusual word, an allusion, a reference to an earlier event, or who a character is. Use only the context you are given about the book so far, and general knowledge about the world or the author. Never reveal or hint at anything that happens later in the book, even if you know the book well. Plain prose, no headings; at most one short list if it truly helps.`;

export const EXPLAIN_PAPER_SYSTEM = `You help someone reading a research paper. They selected a passage and asked what it means.

Explain it briefly (under 150 words) for a smart reader outside the subfield: what the passage claims or does, what its notation and terms mean, and why it matters to the paper's argument. Text extracted from a PDF often garbles equations, so when an image of the selection is attached, read the math and symbols from the image. Ground the explanation in the paper text you are given; use general knowledge of the field for background. Write math in plain text or simple Unicode (x², Σ, ∂), not LaTeX. Plain prose, no headings; at most one short list if it truly helps.`;

export const RECAP_SYSTEM = `You write the "Previously…" recap a reader sees when they return to a book they are partway through.

You get the text they have read so far. Write 5 to 8 short bullet points (under 170 words in total), oldest events first and most recent last, ending exactly where their reading stopped: the main events, who the important characters are and what they want, and any open questions or tensions. Use only the text provided. Never mention, predict or hint at anything beyond it, even if you know the book. Start each bullet with "- ". No heading or preamble.`;

export const RECAP_PAPER_SYSTEM = `You write the "Where you left off" note a reader sees when they return to a research paper they are partway through.

You get the text they have read so far. Write 4 to 7 short bullet points (under 170 words in total), in the paper's order and ending where their reading stopped: the problem and why it matters, the approach, key definitions or notation they will need, and results so far. Use only the text provided; don't summarize sections they haven't reached. Write math in plain text or simple Unicode, not LaTeX. Start each bullet with "- ". No heading or preamble.`;
