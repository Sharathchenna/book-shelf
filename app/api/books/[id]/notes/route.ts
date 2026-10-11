import { requireOwner } from "@/lib/auth/session";
import { putNotes, validId } from "@/lib/library";
import type { Highlight, HighlightColor } from "@/lib/library-types";

const COLORS = new Set<HighlightColor>(["yellow", "green", "blue", "pink"]);

/** Replaces the book's highlights and notes (the reader sends the whole list after each change). */
export async function PUT(request: Request, ctx: RouteContext<"/api/books/[id]/notes">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { notes?: unknown } | null;
  if (!Array.isArray(body?.notes) || body.notes.length > 5000) {
    return Response.json({ error: "Invalid notes." }, { status: 400 });
  }
  const notes: Highlight[] = [];
  for (const n of body.notes as Partial<Highlight>[]) {
    if (typeof n.id !== "string" || typeof n.cfi !== "string" || typeof n.text !== "string" || !COLORS.has(n.color!)) {
      return Response.json({ error: "Invalid note." }, { status: 400 });
    }
    const rects = Array.isArray(n.rects)
      ? n.rects
          .slice(0, 300)
          .filter((r): r is [number, number, number, number] => Array.isArray(r) && r.length === 4 && r.every((v) => typeof v === "number" && Number.isFinite(v)))
          .map((r) => r.map((v) => Math.round(Math.min(2, Math.max(-1, v)) * 1e4) / 1e4) as [number, number, number, number])
      : undefined;
    notes.push({
      id: n.id.slice(0, 64),
      cfi: n.cfi.slice(0, 1000),
      ...(rects?.length ? { rects } : {}),
      text: n.text.slice(0, 4000),
      color: n.color!,
      note: typeof n.note === "string" ? n.note.slice(0, 4000) : undefined,
      sectionIndex: typeof n.sectionIndex === "number" ? n.sectionIndex : 0,
      createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
    });
  }
  await putNotes(id, notes);
  return Response.json({ notes });
}
