import "server-only";
import { getFile, keys } from "../library";
import type { LibraryBook } from "../library-types";
import type { ReaderAction } from "../reader-actions";
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
  const book = await getFile(bookId);
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

/**
 * The other things a selected passage can be asked (lib/reader-actions.ts), each a short task on
 * top of the same rules as Explain: brief, plain prose, only the text given, and for books
 * nothing past where the reader is.
 */
export function actionSystem(action: Exclude<ReaderAction, "explain">, paper: boolean): string {
  const what = paper ? "a research paper" : "a book";
  const scope = paper
    ? "Ground what you say in the paper text you are given."
    : "Use only the book's text you are given, which ends where they are reading. Never reveal or hint at anything that happens later in the book, even if you know it well.";
  const tasks: Record<Exclude<ReaderAction, "explain">, string> = {
    define: `Define the word or phrase they selected as this author uses it here, in one or two sentences (under 60 words). Only if it is archaic, technical or used in an unusual sense, say so and give the plain modern equivalent. Never remark that a word is standard or common.`,
    simplify: `Rewrite the passage they selected in plain, modern English that keeps its full meaning. Then add one short line on the point it makes. Under 120 words in all.`,
    check: `Does the passage still hold up? Search the web for what is known now, then say in 3 to 5 sentences (under 130 words) what has held up, what has changed, and how confident you are. This is mostly outside the text, so say so. Name your sources in the sentences that use them. If the passage is opinion, fiction or a definition rather than a factual claim, say that in one line instead of searching.`,
    connect: `Where else in the text you are given does the author take this up: develop it, support it, or complicate it? Give 2 to 4 pointers, one per line, each starting with "- " and naming the chapter or section, then one line on what happens there with a few quoted words. If the text you have never takes it up elsewhere, say so in one line.`,
    counter: `Give the strongest objection or alternative reading a sharp critic would raise against the passage, in 2 or 3 sentences. Then one line on how the author might answer. Under 110 words in all.`,
  };
  return `You help someone reading ${what}. They selected a passage and asked for something about it.

${tasks[action]}

${scope} Plain prose, no headings or preamble. Write math in plain text or simple Unicode, not LaTeX.`;
}

export const RECAP_SYSTEM = `You write the "Previously…" recap a reader sees when they return to a book they are partway through.

You get the text they have read so far. Write 5 to 8 short bullet points (under 170 words in total), oldest events first and most recent last, ending exactly where their reading stopped: the main events, who the important characters are and what they want, and any open questions or tensions. Use only the text provided. Never mention, predict or hint at anything beyond it, even if you know the book. Start each bullet with "- ". No heading or preamble.`;

export const RECAP_PAPER_SYSTEM = `You write the "Where you left off" note a reader sees when they return to a research paper they are partway through.

You get the text they have read so far. Write 4 to 7 short bullet points (under 170 words in total), in the paper's order and ending where their reading stopped: the problem and why it matters, the approach, key definitions or notation they will need, and results so far. Use only the text provided; don't summarize sections they haven't reached. Write math in plain text or simple Unicode, not LaTeX. Start each bullet with "- ". No heading or preamble.`;

/** The reading companion in the chat panel; `paper` decides whether the whole text is fair game. */
export function chatSystem(paper: boolean): string {
  const scope = paper
    ? `You have the whole paper, so you can discuss any part of it. Explain notation, methods, results and how they connect; when it helps, bring in general knowledge of the field, saying so.`
    : `You have the book's text up to where they are now. Never reveal, hint at or speculate about anything after their position, even if you know the book: if asked, say you'll only talk about what they've read so far.`;
  return `You are the reading companion in someone's private reading app, chatting in a panel beside the ${paper ? "paper" : "book"} they are reading.

${scope}

Ground answers in the text you're given and point to where things are: cite pages as (p. 12) and sections as (§3.2) when the text shows them, or chapter names otherwise. Their highlights and notes, if any, tell you what caught their attention.

Answer conversationally and concisely: short paragraphs, "- " lists only when they help, **bold** for a key term now and then. Write math in plain text or simple Unicode (x², Σ, ∂, √d), never LaTeX. If the question isn't about the ${paper ? "paper" : "book"}, answer briefly and helpfully anyway.`;
}
