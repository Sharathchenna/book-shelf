import "server-only";
import { getClippings, getShelf } from "../data";
import { allNotes, keys, listFiles, shelfItemFor } from "../library";
import type { LibraryBook } from "../library-types";
import { bm25Expanded } from "../search/bm25";
import { bookDoc, clipDoc, type SearchDoc } from "../search/site";
import { nearest } from "../search/vectors";
import { getJson } from "../storage";

/**
 * Ask your whole library, as Readwise Reader's Ghostreader chat does: for each question, the
 * books and clippings nearest it (by meaning, and by its words), and from those the passages of
 * their text and the owner's highlights that bear on it, numbered for the answer to cite.
 */

/** A source the answer can cite, as the app shows it: what it is, and how to open it. */
export type LibrarySource = { n: number; id: string; kind: string; title: string; by?: string; fileId?: string; url?: string };

/** Things looked into per question, and what's taken from each. */
const DOCS = 8;
const PASSAGES_PER_DOC = 3;
const HIGHLIGHTS_PER_DOC = 6;
const CHUNK = 900;

/** A file's text in runs of about CHUNK characters, at paragraph breaks where it can, each with its section's title. */
function chunks(sections: string[], book: LibraryBook): { text: string; where: string }[] {
  const out: { text: string; where: string }[] = [];
  sections.forEach((section, i) => {
    const where = book.sections[i]?.title ?? "";
    let run = "";
    for (const para of section.split(/\n+/)) {
      if (run.length + para.length > CHUNK && run) {
        out.push({ text: run.trim(), where });
        run = "";
      }
      run += `${para}\n`;
    }
    if (run.trim()) out.push({ text: run.trim(), where });
  });
  return out;
}

export async function librarySources(question: string): Promise<{ sources: LibrarySource[]; context: string }> {
  const [shelf, { items: clips }, files, notes] = await Promise.all([getShelf(), getClippings(), listFiles(), allNotes()]);
  const docs: (SearchDoc & { fileId?: string; by?: string })[] = [
    ...shelf.items.map((item) => ({ ...bookDoc(item), by: item.author })),
    ...clips.map((clip) => ({ ...clipDoc(clip), by: clip.author ?? clip.source })),
  ];
  // Each thing's file, when it has one: what it's read in, and where its text and highlights are.
  const fileOf = new Map<string, LibraryBook>();
  for (const file of files) {
    const of = file.paperId ?? file.clipId ?? shelfItemFor(file, shelf.items);
    if (of) fileOf.set(of, file);
  }
  for (const doc of docs) doc.fileId = fileOf.get(doc.id.replace(/^(book|clip):/, ""))?.id;
  // Files of the owner's own, on no shelf: found by their title and author.
  for (const file of files.filter((f) => !(f.paperId ?? f.clipId ?? shelfItemFor(f, shelf.items)))) {
    docs.push({ id: `file:${file.id}`, kind: "book", title: file.title, subtitle: file.author, href: "", card: `A book. ${file.title} by ${file.author}`, text: `${file.title} ${file.author}`, passage: "", fileId: file.id, by: file.author });
  }

  const byId = new Map(docs.map((d) => [d.id, d]));
  const near = (await nearest(question, DOCS).catch(() => null)) ?? [];
  // The highlights and the text behind the nearest things count as their words too.
  const noted = (d: (typeof docs)[number]) => `${d.text} ${d.fileId ? (notes.get(d.fileId) ?? []).map((n) => `${n.text} ${n.note ?? ""}`).join(" ") : ""}`;
  const words = bm25Expanded(question, [], docs, noted, DOCS).filter((r) => r.score > 0);
  const chosen: typeof docs = [];
  for (const id of [...near.map((n) => n.id), ...words.map((w) => w.item.id)]) {
    const doc = byId.get(id);
    if (doc && !chosen.includes(doc)) chosen.push(doc);
    if (chosen.length >= DOCS) break;
  }

  const sources: LibrarySource[] = [];
  const parts: string[] = [];
  for (const doc of chosen) {
    const n = sources.length + 1;
    const [kind, ownId] = [doc.id.split(":")[0], doc.id.replace(/^(book|clip|file):/, "")];
    sources.push({ n, id: ownId, kind: kind === "clip" ? doc.kind : "book", title: doc.title, by: doc.by, fileId: doc.fileId, url: doc.href || undefined });
    const lines = [`[${n}] ${doc.card.slice(0, 1200)}`];
    if (doc.fileId) {
      const file = files.find((f) => f.id === doc.fileId)!;
      const highlights = bm25Expanded(question, [], notes.get(doc.fileId) ?? [], (h) => `${h.text} ${h.note ?? ""}`, HIGHLIGHTS_PER_DOC).filter((h) => h.item.text.trim());
      if (highlights.length) {
        lines.push("The owner's highlights in it:");
        for (const { item: h } of highlights) lines.push(`- "${h.text.slice(0, 400)}"${h.note ? ` (their note: ${h.note.slice(0, 300)})` : ""}`);
      }
      const sections = await getJson<string[]>(keys.text(file.id)).catch(() => null);
      const found = sections ? bm25Expanded(question, [], chunks(sections, file), (c) => c.text, PASSAGES_PER_DOC).filter((c) => c.score > 0) : [];
      if (found.length) {
        lines.push("From its text:");
        for (const { item: c } of found) lines.push(`(${c.where}) ${c.text}`);
      }
    }
    parts.push(lines.join("\n"));
  }
  return { sources, context: parts.join("\n\n---\n\n") };
}

export const LIBRARY_CHAT_SYSTEM = `You are the reading companion in someone's private reading app, answering questions about their whole library: the books they've read or are reading, and the articles, papers, posts, videos and episodes they've saved, with their own highlights and notes.

For each question you're given numbered sources from their library: what each is, the owner's highlights in it, and passages from its text. Answer from those, citing them as [1], [2] right after the sentence that uses them. Say which of their things bear on the question and what they say, and bring in their highlights when they're relevant ("you highlighted…"). If the sources don't cover the question, say so plainly, then answer briefly from general knowledge, saying that's what it is. Never invent a source or a quotation.

Answer conversationally and concisely: short paragraphs, "- " lists when they help, **bold** for a key term now and then. Write math in plain text or simple Unicode, never LaTeX.`;
