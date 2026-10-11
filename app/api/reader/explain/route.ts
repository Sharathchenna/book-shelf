import { haikuEnabled, streamText } from "@/lib/ai/haiku";
import { EXPLAIN_PAPER_SYSTEM, EXPLAIN_SYSTEM, textSoFar } from "@/lib/ai/reader";
import { requireOwner } from "@/lib/auth/session";
import { aiResponse } from "../stream";

/** Recent text before the selection, for context. Enough for most passages; keeps answers quick. */
const CONTEXT_CHARS = 12_000;
/** A JPEG of the selection, as base64; PDFs send one so equations survive. */
const MAX_IMAGE_CHARS = 2_000_000;

/** Explains a passage the owner selected, using only what comes before it. */
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

  const sofar = await textSoFar(body.bookId, body.sectionIndex, body.sectionFraction, CONTEXT_CHARS);
  if (!sofar) return Response.json({ error: "Unknown book." }, { status: 404 });
  const chapter = sofar.book.sections[body.sectionIndex]?.title ?? "";
  const isPaper = Boolean(sofar.book.paperId);
  const image = typeof body.image === "string" && body.image.length < MAX_IMAGE_CHARS && body.image.startsWith("/9j/") ? body.image : undefined;
  const prompt = `${isPaper ? "Paper" : "Book"}: ${sofar.book.title} by ${sofar.book.author}\n${isPaper ? "Section" : "Chapter"}: ${chapter}\n\nThe text just before and around the passage:\n"""\n${sofar.text}\n"""\n\nThe passage they selected${image ? " (an image of it on the page is attached)" : ""}:\n"""\n${body.selection!.toString().slice(0, 2000)}\n"""`;

  return aiResponse(request.signal, (write) =>
    streamText(
      {
        max_tokens: 2048,
        output_config: { effort: "low" },
        system: isPaper ? EXPLAIN_PAPER_SYSTEM : EXPLAIN_SYSTEM,
        messages: [
          {
            role: "user",
            content: image
              ? [
                  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
                  { type: "text", text: prompt },
                ]
              : prompt,
          },
        ],
      },
      write,
      request.signal,
    ),
  );
}
