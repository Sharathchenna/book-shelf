import { haikuEnabled, streamText } from "@/lib/ai/haiku";
import { byline, chatSystem, textSoFar } from "@/lib/ai/reader";
import { requireOwner } from "@/lib/auth/session";
import { getFile, getNotes } from "@/lib/library";
import { aiResponse } from "../stream";

/** About 150k tokens; the oldest text is dropped beyond that (books only grow this long). */
const MAX_CHARS = 600_000;
const MAX_MESSAGES = 40;
const MAX_IMAGE_CHARS = 2_000_000;

type Message = { role: "user" | "assistant"; content: string };

/**
 * The reader's chat panel. A paper's whole text is in context; a book's only up to the reader's
 * position, so nothing ahead is spoiled. The text sits in a cached prefix, so a conversation
 * re-reads it from cache. The last message can carry a quoted passage (and, from a PDF, an image of it).
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    bookId?: unknown;
    sectionIndex?: unknown;
    sectionFraction?: unknown;
    messages?: unknown;
    quote?: unknown;
    image?: unknown;
  };
  const messages = Array.isArray(body.messages)
    ? (body.messages as Partial<Message>[])
        .filter((m): m is Message => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    : [];
  if (
    typeof body.bookId !== "string" ||
    typeof body.sectionIndex !== "number" ||
    typeof body.sectionFraction !== "number" ||
    messages.at(-1)?.role !== "user"
  ) {
    return Response.json({ error: "Ask something first." }, { status: 400 });
  }
  // The API wants the conversation to open with the user and alternate; a failed answer can
  // leave two questions in a row, which become one.
  while (messages[0]?.role === "assistant") messages.shift();
  for (let i = messages.length - 1; i > 0; i--) {
    if (messages[i].role === messages[i - 1].role) {
      messages[i - 1] = { role: messages[i].role, content: `${messages[i - 1].content}\n\n${messages[i].content}` };
      messages.splice(i, 1);
    }
  }

  const book = await getFile(body.bookId);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  const paper = Boolean(book.paperId);
  const last = book.sections.length - 1;
  const [sofar, notes] = await Promise.all([
    paper
      ? textSoFar(book.id, last, 1, MAX_CHARS)
      : textSoFar(book.id, body.sectionIndex, body.sectionFraction, MAX_CHARS),
    getNotes(book.id),
  ]);
  if (!sofar) return Response.json({ error: "Unknown book." }, { status: 404 });

  const where = book.sections[Math.min(Math.max(0, Math.floor(body.sectionIndex)), last)]?.title ?? "";
  const highlights = notes
    .slice(-60)
    .map((n) => `- (${book.sections[n.sectionIndex]?.title ?? ""}) "${n.text.slice(0, 300)}"${n.note ? ` — their note: ${n.note.slice(0, 300)}` : ""}`)
    .join("\n");

  const quote = typeof body.quote === "string" && body.quote.trim() ? body.quote.slice(0, 3000) : undefined;
  const image = typeof body.image === "string" && body.image.length < MAX_IMAGE_CHARS && body.image.startsWith("/9j/") ? body.image : undefined;
  const question = messages.at(-1)!.content;
  const lastText = quote
    ? `The passage I'm asking about${image ? " (an image of it on the page is attached)" : ""}:\n"""\n${quote}\n"""\n\n${question}`
    : question;
  const turns = messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

  return aiResponse(request.signal, (write) =>
    streamText(
      {
        max_tokens: 2048,
        system: [
          { type: "text", text: chatSystem(paper) },
          {
            type: "text",
            text: `${paper ? "Paper" : "Book"}: ${byline(book)}\n\n${paper ? "The whole paper" : "Everything read so far"}:\n"""\n${sofar.text}\n"""`,
            // The long, stable part: later messages in the conversation read it from cache.
            cache_control: { type: "ephemeral" },
          },
          {
            type: "text",
            text: `They are reading: ${where}.${highlights ? `\n\nTheir highlights and notes:\n${highlights}` : ""}`,
          },
        ],
        messages: [
          ...turns,
          {
            role: "user",
            content: image
              ? [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
                  { type: "text", text: lastText },
                ]
              : lastText,
          },
        ],
      },
      write,
      request.signal,
    ),
  );
}
