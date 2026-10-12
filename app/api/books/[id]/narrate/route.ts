import { requireOwner } from "@/lib/auth/session";
import { getFile, validVoice } from "@/lib/library";
import { askNarrator, relay } from "@/lib/narrator";

/**
 * Chapters the GPU server is saving for a book. It speaks each, then saves it like the browser
 * does (`/api/books/[id]/audio/[section]`), so nothing here waits for it.
 */

type Ctx = RouteContext<"/api/books/[id]/narrate">;

/** Its chapters in a voice, and how far each has got: `?voice=af_heart`. */
export async function GET(request: Request, ctx: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const voice = new URL(request.url).searchParams.get("voice") ?? "";
  if (!validVoice(voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  const res = await askNarrator(`/jobs?book=${encodeURIComponent(id)}`);
  if (!res?.ok) return relay(res);
  const { jobs } = (await res.json()) as { jobs: { voice: string }[] };
  return Response.json({ jobs: jobs.filter((job) => job.voice === voice) }, { headers: { "cache-control": "no-store" } });
}

/** Asks for chapters to be saved: `{ voice, chapters: [{ section, lines }], urgent }`, each line as the reader split it. */
export async function POST(request: Request, ctx: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { voice?: unknown; chapters?: unknown; urgent?: unknown };
  if (typeof body.voice !== "string" || !validVoice(body.voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  const book = await getFile(id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  const chapters = body.chapters as { section: number; lines: unknown[] }[];
  const valid =
    Array.isArray(chapters) && chapters.length > 0 &&
    chapters.every((c) => Number.isInteger(c?.section) && c.section >= 0 && c.section < book.sections.length && Array.isArray(c.lines));
  if (!valid) return Response.json({ error: "Invalid chapters." }, { status: 400 });
  const res = await askNarrator("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ book: id, voice: body.voice, chapters, urgent: body.urgent === true }),
  });
  return relay(res);
}

/** Stops saving the book in a voice: `?voice=af_heart`. */
export async function DELETE(request: Request, ctx: Ctx) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const voice = new URL(request.url).searchParams.get("voice") ?? "";
  if (!validVoice(voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  return relay(await askNarrator(`/jobs?book=${encodeURIComponent(id)}&voice=${voice}`, { method: "DELETE" }));
}
