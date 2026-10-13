import { direct } from "@/lib/ai/director";
import { haikuEnabled } from "@/lib/ai/haiku";
import { requireOwner } from "@/lib/auth/session";
import { DIRECTION_CHUNK, DIRECTOR_VERSION, type Direction } from "@/lib/directions";
import { getDirections, getFile, putDirections } from "@/lib/library";

/**
 * How a Fish voice should deliver a run of a chapter's sentences: `{ section, chunk, sentences,
 * before }` → `{ directions }`, one per sentence (null for none). Made by Claude Haiku the
 * first time and kept, so listening and saving use the same. Without Haiku, or when it fails,
 * every direction is null and the sentences are read as they are.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[id]/directions">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { section?: unknown; chunk?: unknown; sentences?: unknown; before?: unknown };
  const book = await getFile(id);
  if (!book) return Response.json({ error: "Unknown book." }, { status: 404 });
  const strings = (v: unknown, max: number): v is string[] =>
    Array.isArray(v) && v.length <= max && v.every((s) => typeof s === "string" && s.length <= 5000);
  const { section, chunk, sentences, before } = body;
  if (
    !Number.isInteger(section) || (section as number) < 0 || (section as number) >= book.sections.length ||
    !Number.isInteger(chunk) || (chunk as number) < 0 || !strings(sentences, DIRECTION_CHUNK) || !sentences.length || !strings(before ?? [], 5)
  ) {
    return Response.json({ error: "Invalid sentences." }, { status: 400 });
  }
  const none = () => Response.json({ directions: sentences.map(() => null), directed: false });
  if (!haikuEnabled()) return none();

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([DIRECTOR_VERSION, sentences])));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
  const stored = await getDirections(id, section as number, chunk as number, hash);
  if (stored) return Response.json({ directions: stored, directed: true });

  let directions: (Direction | null)[];
  try {
    directions = await direct({ title: book.title, author: book.author, paper: Boolean(book.paperId), sentences, before: (before as string[] | undefined) ?? [] });
  } catch (error) {
    console.error("Directing failed", id, section, chunk, error);
    return none();
  }
  await putDirections(id, section as number, chunk as number, hash, directions);
  return Response.json({ directions, directed: true });
}
