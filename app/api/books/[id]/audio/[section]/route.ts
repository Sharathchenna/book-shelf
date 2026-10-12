import { fromNarrator, requireOwner } from "@/lib/auth/session";
import { getAudio, getFile, keys, putAudio, validVoice } from "@/lib/library";
import type { AudioLine, LibraryBook } from "@/lib/library-types";
import { getStorage } from "@/lib/storage";

/** A chapter at 64 kbps runs about 0.5 MB a minute; this allows over six hours. */
const MAX_BYTES = 200 * 1024 * 1024;

type Ctx = RouteContext<"/api/books/[id]/audio/[section]">;

/**
 * The book and section a request is about, and the voice it names, or the error to send back.
 * Saving is open to the narrator's GPU server too (`narrator`), which saves the chapters it reads.
 */
async function target(
  request: Request,
  ctx: Ctx,
  voice: unknown,
  { narrator = false } = {},
): Promise<{ book: LibraryBook; section: number; voice: string } | Response> {
  if (!(narrator && fromNarrator(request))) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  const params = await ctx.params;
  if (typeof voice !== "string" || !validVoice(voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  const book = await getFile(params.id);
  const section = Number(params.section);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  if (!Number.isInteger(section) || section < 0 || section >= book.sections.length) {
    return Response.json({ error: "Unknown section." }, { status: 404 });
  }
  return { book, section, voice };
}

/** A narrated chapter: a short-lived URL for its MP3, and its sentences' timings. */
export async function GET(request: Request, ctx: Ctx) {
  const found = await target(request, ctx, new URL(request.url).searchParams.get("voice"));
  if (found instanceof Response) return found;
  const { book, section, voice } = found;
  const audio = await getAudio(book.id, voice, section);
  if (!audio) return Response.json({ error: "Not narrated yet." }, { status: 404 });
  const url = await getStorage().downloadUrl(keys.audio(book.id, voice, section));
  return Response.json({ ...audio, url }, { headers: { "cache-control": "no-store" } });
}

/** Starts saving a chapter's narration: a URL to PUT exactly `bytes` bytes of MP3 to. */
export async function POST(request: Request, ctx: Ctx) {
  const body = (await request.json().catch(() => ({}))) as { voice?: unknown; bytes?: unknown };
  const found = await target(request, ctx, body.voice, { narrator: true });
  if (found instanceof Response) return found;
  const { book, section, voice } = found;
  if (typeof body.bytes !== "number" || !Number.isInteger(body.bytes) || body.bytes <= 0 || body.bytes > MAX_BYTES) {
    return Response.json({ error: "Invalid size." }, { status: 400 });
  }
  const uploadUrl = await getStorage().uploadUrl(keys.audio(book.id, voice, section), "audio/mpeg", body.bytes);
  return Response.json({ uploadUrl });
}

const validLine = (l: AudioLine) =>
  Number.isInteger(l.start) && Number.isInteger(l.end) && l.start >= 0 && l.end >= l.start &&
  typeof l.text === "string" && l.text.length <= 20_000 &&
  Number.isFinite(l.t0) && Number.isFinite(l.t1) && l.t0 >= 0 && l.t1 >= l.t0;

/** Finishes saving: once the MP3 is in storage, records the chapter and its sentences' timings. */
export async function PUT(request: Request, ctx: Ctx) {
  const body = (await request.json().catch(() => ({}))) as { voice?: unknown; bytes?: unknown; duration?: unknown; lines?: unknown };
  const found = await target(request, ctx, body.voice, { narrator: true });
  if (found instanceof Response) return found;
  const { book, section, voice } = found;
  const lines = body.lines as AudioLine[];
  if (
    typeof body.duration !== "number" || !Number.isFinite(body.duration) || body.duration <= 0 ||
    !Array.isArray(lines) || !lines.length || lines.length > 20_000 || !lines.every(validLine)
  ) {
    return Response.json({ error: "Invalid narration." }, { status: 400 });
  }
  const stored = await getStorage().size(keys.audio(book.id, voice, section));
  if (stored === null || stored !== body.bytes) return Response.json({ error: "The audio didn't arrive." }, { status: 409 });

  await putAudio(
    book.id,
    {
      section,
      voice,
      duration: body.duration,
      lines: lines.map(({ start, end, text, t0, t1 }) => ({ start, end, text, t0, t1 })),
    },
    stored,
  );
  return new Response(null, { status: 204 });
}
