import { requireOwner } from "@/lib/auth/session";
import { getNotes, mergeNotes, validId } from "@/lib/library";
import type { Highlight, HighlightColor, Ink } from "@/lib/library-types";

const COLORS = new Set<HighlightColor>(["yellow", "green", "blue", "pink"]);

/** A book's highlights and notes, with the markers of removed ones, for a device to sync from. */
export async function GET(_request: Request, ctx: RouteContext<"/api/books/[id]/notes">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });
  return Response.json({ notes: await getNotes(id, { removed: true }) }, { headers: { "cache-control": "no-store" } });
}

/**
 * Changes to a book's highlights: { changes: Highlight[] }, each one new, edited, or removed
 * (`deleted: true`). Merged by id, the newer winning (lib/library.ts). Answers with the book's
 * highlights afterwards.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[id]/notes">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { changes?: unknown } | null;
  const changes = parse(body?.changes);
  if (!changes) return Response.json({ error: "Invalid notes." }, { status: 400 });
  return Response.json({ notes: await mergeNotes(id, changes) });
}

/**
 * The whole list, as reader tabs opened before changes were sent one by one still save. Taken as
 * changes: what's in it is kept, but nothing missing from it is removed, since another device
 * may have added it since the tab opened.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/books/[id]/notes">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "Unknown book." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as { notes?: unknown } | null;
  const changes = parse(body?.notes);
  if (!changes) return Response.json({ error: "Invalid notes." }, { status: 400 });
  return Response.json({ notes: (await mergeNotes(id, changes)).filter((n) => !n.deleted) });
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);

/** The highlights in a request, cleaned, or null when any is malformed. */
function parse(list: unknown): Highlight[] | null {
  if (!Array.isArray(list) || list.length > 5000) return null;
  const notes: Highlight[] = [];
  for (const n of list as Partial<Highlight>[]) {
    if (typeof n?.id !== "string" || typeof n.cfi !== "string" || typeof n.text !== "string" || !COLORS.has(n.color!)) return null;
    const rects = Array.isArray(n.rects)
      ? n.rects
          .slice(0, 300)
          .filter((r): r is [number, number, number, number] => Array.isArray(r) && r.length === 4 && r.every(finite))
          .map((r) => r.map((v) => Math.round(Math.min(2, Math.max(-1, v)) * 1e4) / 1e4) as [number, number, number, number])
      : undefined;
    const ink = n.ink === undefined ? undefined : parseInk(n.ink);
    if (ink === null) return null;
    const quote = n.quote && typeof n.quote === "object" ? { before: text(n.quote.before, 200) ?? "", after: text(n.quote.after, 200) ?? "" } : undefined;
    const createdAt = iso(n.createdAt) ?? new Date().toISOString();
    notes.push({
      id: n.id.slice(0, 64),
      cfi: n.cfi.slice(0, 1000),
      ...(rects?.length ? { rects } : {}),
      text: n.text.slice(0, 4000),
      ...(quote ? { quote } : {}),
      ...(finite(n.progression) ? { progression: Math.min(1, Math.max(0, n.progression)) } : {}),
      color: n.color!,
      note: text(n.note, 4000),
      ...(ink ? { ink } : {}),
      sectionIndex: finite(n.sectionIndex) ? Math.max(0, Math.floor(n.sectionIndex)) : 0,
      createdAt,
      updatedAt: iso(n.updatedAt) ?? createdAt,
      ...(n.deleted === true ? { deleted: true } : {}),
    });
  }
  return notes;
}

/** Up to 400 strokes and 30,000 points a drawing, rounded to what a screen can show. */
function parseInk(v: unknown): Ink | null {
  const ink = v as Partial<Ink>;
  if (!ink || (ink.place !== "page" && ink.place !== "margin") || !Array.isArray(ink.size) || ink.size.length !== 2 || !ink.size.every(finite)) return null;
  if (!Array.isArray(ink.strokes) || ink.strokes.length > 400) return null;
  const digits = ink.place === "page" ? 1e4 : 10;
  let total = 0;
  const strokes: Ink["strokes"] = [];
  for (const s of ink.strokes) {
    if (!s || typeof s.color !== "string" || !/^#[0-9a-f]{6,8}$/i.test(s.color) || !finite(s.width) || !Array.isArray(s.points)) return null;
    if (s.points.length % 3 || !s.points.every(finite)) return null;
    total += s.points.length / 3;
    if (total > 30_000) return null;
    strokes.push({ color: s.color, width: Math.round(s.width * 100) / 100, points: s.points.map((p, i) => (i % 3 === 2 ? Math.round(p * 100) / 100 : Math.round(p * digits) / digits)) });
  }
  const offset = Array.isArray(ink.offset) && ink.offset.length === 2 && ink.offset.every(finite) ? ([ink.offset[0], ink.offset[1]] as [number, number]) : undefined;
  return {
    place: ink.place,
    size: [ink.size[0], ink.size[1]],
    ...(offset ? { offset } : {}),
    strokes,
    ...(typeof ink.recognized === "string" ? { recognized: ink.recognized.slice(0, 4000) } : {}),
  };
}
