import { requireOwner } from "@/lib/auth/session";
import { putProgress, validId } from "@/lib/library";
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
  const progress: Progress = {
    cfi: body.cfi,
    fraction: Math.min(1, Math.max(0, body.fraction)),
    sectionIndex: Math.max(0, Math.floor(body.sectionIndex)),
    updatedAt: new Date().toISOString(),
  };
  await putProgress(id, progress);
  return Response.json({ progress });
}
