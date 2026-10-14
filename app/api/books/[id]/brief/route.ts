import { writeBrief } from "@/lib/ai/brief";
import { haikuEnabled } from "@/lib/ai/haiku";
import { requireOwner } from "@/lib/auth/session";
import { BRIEF_VERSION, type StoredBrief } from "@/lib/brief-types";
import { getFile, keys } from "@/lib/library";
import { getJson, putJson } from "@/lib/storage";

/**
 * A paper's or article's brief (lib/ai/brief.ts): GET the one written before (404 when there
 * is none), POST to write it (or write it again). Kept beside the file's text in storage.
 */
export async function GET(_: Request, ctx: RouteContext<"/api/books/[id]/brief">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const stored = await getJson<StoredBrief>(keys.brief(id)).catch(() => null);
  if (!stored || stored.version !== BRIEF_VERSION) return Response.json({ error: "No brief yet." }, { status: 404 });
  return Response.json(stored, { headers: { "cache-control": "no-store" } });
}

export async function POST(_: Request, ctx: RouteContext<"/api/books/[id]/brief">) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });
  const { id } = await ctx.params;
  const book = await getFile(id);
  const sections = book && (await getJson<string[]>(keys.text(id)));
  if (!book || !sections) return Response.json({ error: "Unknown book." }, { status: 404 });
  if (!book.paperId && !book.clipId) return Response.json({ error: "Briefs are for papers and articles." }, { status: 400 });
  try {
    const brief = await writeBrief(book, sections);
    if (!brief) return Response.json({ error: "Couldn't write a brief for this one." }, { status: 422 });
    const stored: StoredBrief = { version: BRIEF_VERSION, at: new Date().toISOString(), brief };
    await putJson(keys.brief(id), stored);
    return Response.json(stored);
  } catch (error) {
    console.error("Brief failed", id, error);
    return Response.json({ error: "Couldn't write the brief. Try again." }, { status: 502 });
  }
}
