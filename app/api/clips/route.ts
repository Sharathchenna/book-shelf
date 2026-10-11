import { requireOwner } from "@/lib/auth/session";
import { clipId, clipLink, expand } from "@/lib/clip";
import { CLIP_KINDS } from "@/lib/clippings";
import { deleteClipping, getClipping, saveClipping } from "@/lib/data";
import type { ClipKind } from "@/lib/types";

/**
 * Clipping from the website. POST { url, kind?, note?, tags? } fetches the link's details and
 * saves it (clipping it again refreshes it); DELETE { id } removes one. Owner only.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = (await request.json().catch(() => ({}))) as { url?: unknown; kind?: unknown; note?: unknown; tags?: unknown };
  if (typeof body.url !== "string" || !body.url.trim() || body.url.length > 2000) {
    return Response.json({ error: "Paste a link." }, { status: 400 });
  }
  const kind = CLIP_KINDS.includes(body.kind as ClipKind) ? (body.kind as ClipKind) : undefined;
  const note = typeof body.note === "string" ? body.note.slice(0, 2000) : undefined;
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "").map((t) => t.trim().slice(0, 40)).slice(0, 12)
    : undefined;

  let existing = null;
  try {
    existing = await getClipping(clipId(expand(body.url.trim())));
  } catch {
    // Not a parseable URL; clipLink explains.
  }
  try {
    const clip = await clipLink(body.url, { kind, note, tags }, existing);
    await saveClipping(clip);
    return Response.json({ clip, refreshed: Boolean(existing) });
  } catch (error) {
    return Response.json({ error: `Couldn't clip that: ${(error as Error).message}` }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string" || !(await deleteClipping(id))) {
    return Response.json({ error: "Unknown clipping." }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
