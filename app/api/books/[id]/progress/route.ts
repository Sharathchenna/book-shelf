import { requireOwner } from "@/lib/auth/session";
import { getProgress, putProgress, validId } from "@/lib/library";
import type { Progress } from "@/lib/library-types";

/** Saves where the owner is in a book (sent, debounced, as they read). */
export async function PUT(request: Request, ctx: RouteContext<"/api/books/[id]/progress">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Partial<Progress>;
  if (
    typeof body.cfi !== "string" ||
    body.cfi.length > 1000 ||
    typeof body.fraction !== "number" ||
    typeof body.sectionIndex !== "number"
  ) {
    return Response.json({ error: "Invalid position." }, { status: 400 });
  }
  // A device sends when it was there, which may be a while ago if it was offline: an older place
  // than the one kept doesn't replace it.
  const now = new Date().toISOString();
  const at = typeof body.updatedAt === "string" && !Number.isNaN(Date.parse(body.updatedAt)) && body.updatedAt < now ? body.updatedAt : now;
  const kept = await getProgress(id);
  if (kept && kept.updatedAt > at) return Response.json({ progress: kept });
  const progress: Progress = {
    cfi: body.cfi,
    fraction: Math.min(1, Math.max(0, body.fraction)),
    sectionIndex: Math.max(0, Math.floor(body.sectionIndex)),
    ...(typeof body.progression === "number" && Number.isFinite(body.progression) ? { progression: Math.min(1, Math.max(0, body.progression)) } : {}),
    updatedAt: at,
  };
  await putProgress(id, progress);
  return Response.json({ progress });
}
