import { haikuEnabled, streamText } from "@/lib/ai/haiku";
import { RECAP_SYSTEM, textSoFar } from "@/lib/ai/reader";
import { requireOwner } from "@/lib/auth/session";
import { aiResponse } from "../stream";

/** About 150k tokens of the most recent text; the oldest chapters are dropped beyond that. */
const MAX_CHARS = 600_000;

/** A spoiler-free "Previously…" recap of everything before the owner's position. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as {
    bookId?: unknown;
    sectionIndex?: unknown;
    sectionFraction?: unknown;
  };
  if (typeof body.bookId !== "string" || typeof body.sectionIndex !== "number" || typeof body.sectionFraction !== "number") {
    return Response.json({ error: "Invalid position." }, { status: 400 });
  }

  const sofar = await textSoFar(body.bookId, body.sectionIndex, body.sectionFraction, MAX_CHARS);
  if (!sofar) return Response.json({ error: "Unknown book." }, { status: 404 });
  if (sofar.text.length < 400) return Response.json({ error: "Read a little further first." }, { status: 400 });

  return aiResponse(request.signal, (write) =>
    streamText(
      {
        max_tokens: 4096,
        output_config: { effort: "low" },
        system: RECAP_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Book: ${sofar.book.title} by ${sofar.book.author}\n\nEverything read so far:\n"""\n${sofar.text}\n"""`,
                // The book text is the long, stable prefix; asking again at the same spot reads it from cache.
                cache_control: { type: "ephemeral" },
              },
              { type: "text", text: "Write the recap." },
            ],
          },
        ],
      },
      write,
      request.signal,
    ),
  );
}
