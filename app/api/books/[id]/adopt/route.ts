import { requireOwner } from "@/lib/auth/session";
import { adoptFile, getFile, validId } from "@/lib/library";

/**
 * A rebuilt copy taking over from the copy before it: { from } hands its highlights, their places
 * in the review and the owner's place to this one (lib/library.ts adoptFile). The caller then
 * deletes the old copy.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[id]/adopt">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const { from } = (await request.json().catch(() => ({}))) as { from?: unknown };
  if (!validId(id) || typeof from !== "string" || !validId(from) || from === id) return Response.json({ error: "Unknown book." }, { status: 404 });
  const [to, old] = await Promise.all([getFile(id), getFile(from)]);
  if (!to || !old) return Response.json({ error: "Unknown book." }, { status: 404 });
  await adoptFile(id, from);
  return Response.json({ ok: true });
}
