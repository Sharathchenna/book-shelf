import type Anthropic from "@anthropic-ai/sdk";
import { anthropic, HAIKU, haikuEnabled, streamText } from "@/lib/ai/haiku";
import { actionSystem, byline, EXPLAIN_PAPER_SYSTEM, EXPLAIN_SYSTEM, textSoFar } from "@/lib/ai/reader";
import { requireOwner } from "@/lib/auth/session";
import { isReaderAction, type ReaderAction } from "@/lib/reader-actions";
import { aiResponse } from "../stream";

/** Recent text before the selection, for context. Enough for most passages; keeps answers quick. */
const CONTEXT_CHARS = 12_000;
/** Related looks across the text, not just around the passage: a book so far, or a whole paper. */
const CONNECT_CHARS = 240_000;
/** Fact-check searches the web at most this often per passage (Anthropic charges $0.01 a search). */
const MAX_SEARCHES = 2;
/** A JPEG of the selection, as base64; PDFs send one so equations survive. */
const MAX_IMAGE_CHARS = 2_000_000;

/**
 * Explains a passage the owner selected (or defines it, simplifies it, fact-checks it against the
 * web, finds where else the text takes it up, or argues against it: `action`), using only what
 * comes before it in a book.
 */
/** How far past the selection's place the context runs: a screenful of text, about. */
const AROUND_CHARS = 2500;

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    bookId?: unknown;
    sectionIndex?: unknown;
    sectionFraction?: unknown;
    selection?: unknown;
    image?: unknown;
    action?: unknown;
    language?: unknown;
  };
  if (
    typeof body.bookId !== "string" ||
    typeof body.sectionIndex !== "number" ||
    typeof body.sectionFraction !== "number" ||
    typeof body.selection !== "string" ||
    !body.selection.trim()
  ) {
    return Response.json({ error: "Select some text first." }, { status: 400 });
  }

  const action: ReaderAction = isReaderAction(body.action) ? body.action : "explain";
  // The text a little past the place too, so the passage (which can start below where its screen does) is in it.
  const first = await textSoFar(body.bookId, body.sectionIndex, body.sectionFraction, action === "connect" ? CONNECT_CHARS : CONTEXT_CHARS, AROUND_CHARS);
  if (!first) return Response.json({ error: "Unknown book." }, { status: 404 });
  const isPaper = Boolean(first.book.paperId);
  // A paper has no spoilers: Related reads all of it.
  const sofar = action === "connect" && isPaper ? ((await textSoFar(body.bookId, first.book.sections.length - 1, 1, CONNECT_CHARS)) ?? first) : first;
  const chapter = sofar.book.sections[body.sectionIndex]?.title ?? "";
  const image = typeof body.image === "string" && body.image.length < MAX_IMAGE_CHARS && body.image.startsWith("/9j/") ? body.image : undefined;
  const context = action === "connect" ? (isPaper ? "The paper" : "The book so far") : "The text just before and around the passage";
  const prompt = `${isPaper ? "Paper" : "Book"}: ${byline(sofar.book)}\n${isPaper ? "Section" : "Chapter"}: ${chapter}\n\n${context}:\n"""\n${sofar.text}\n"""\n\nThe passage they selected${image ? " (an image of it on the page is attached)" : ""}:\n"""\n${body.selection!.toString().slice(0, 2000)}\n"""`;

  const content = image
    ? [
        { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image } },
        { type: "text" as const, text: prompt },
      ]
    : prompt;
  // Translate's language, as the reader chose it (English unless asked).
  const language = typeof body.language === "string" && /^[\p{L} ()-]{2,40}$/u.test(body.language) ? body.language : undefined;
  const system = action === "explain" ? (isPaper ? EXPLAIN_PAPER_SYSTEM : EXPLAIN_SYSTEM) : actionSystem(action, isPaper, language);

  if (action === "check") return aiResponse(request.signal, (write) => factCheck(system, content, write, request.signal));
  return aiResponse(request.signal, (write) =>
    streamText({ max_tokens: 2048, output_config: { effort: "low" }, system, messages: [{ role: "user", content }] }, write, request.signal),
  );
}

/**
 * Fact-check: Haiku with Anthropic's web search (the basic version; Haiku doesn't take the one
 * that filters results with code). The answer streams as it's written, then the pages it cited.
 */
async function factCheck(
  system: string,
  content: Anthropic.MessageParam["content"],
  write: (text: string) => void,
  signal: AbortSignal,
): Promise<boolean> {
  const stream = anthropic().messages.stream(
    {
      model: HAIKU,
      max_tokens: 2048,
      output_config: { effort: "low" },
      system,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES }],
      messages: [{ role: "user", content }],
    },
    { signal },
  );
  // A line written before the search ("Let me look that up") would sit oddly above the answer.
  let searched = false;
  let held = "";
  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
      searched = true;
      held = "";
    }
  });
  stream.on("text", (text) => {
    if (searched) write(text);
    else held += text;
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") return false;
  if (!searched && held) write(held);
  // Each page it cited, once, in order.
  const cited = new Map<string, string>();
  for (const block of message.content) {
    if (block.type !== "text") continue;
    for (const c of block.citations ?? []) if (c.type === "web_search_result_location" && !cited.has(c.url)) cited.set(c.url, c.title ?? c.url);
  }
  if (cited.size) write(`\n\nSources:\n${[...cited].map(([url, title]) => `- ${title} ${url}`).join("\n")}`);
  return true;
}
