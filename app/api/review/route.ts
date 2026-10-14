import { requireOwner } from "@/lib/auth/session";
import { allNotes, allReviews, listFiles, putReview } from "@/lib/library";
import { DAILY, keepInRotation, retire, todaysReview } from "@/lib/review";

/** Today's start, from the browser (epoch ms of its midnight), if it's plausible; else the server's. */
function todayFrom(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n - Date.now()) < 2 * 86_400_000 ? n : new Date().setUTCHours(0, 0, 0, 0);
}

/**
 * The daily review on the library page (lib/review.ts): GET ?today=<ms> lists today's highlights
 * still to see; POST { id, fileId, keep, today } records one seen, kept in rotation or done with.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const today = todayFrom(new URL(request.url).searchParams.get("today"));
  const [notes, reviews, files] = await Promise.all([allNotes(), allReviews(), listFiles()]);
  const byId = new Map(files.map((f) => [f.id, f]));
  const all = [...notes].flatMap(([fileId, highlights]) =>
    byId.has(fileId) ? highlights.map((h) => ({ ...h, fileId, review: reviews.get(h.id) })) : [],
  );
  const { deck, done } = todaysReview(all, today);
  return Response.json(
    {
      done,
      total: Math.min(DAILY, done + deck.length),
      deck: deck.map((h) => {
        const book = byId.get(h.fileId)!;
        return {
          id: h.id,
          fileId: h.fileId,
          text: h.text,
          ...(h.note ? { note: h.note } : {}),
          color: h.color,
          title: book.title,
          author: book.author,
          href: `/reader/${h.fileId}?at=${encodeURIComponent(h.cfi)}`,
        };
      }),
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { id?: unknown; fileId?: unknown; keep?: unknown; today?: unknown };
  if (typeof body.id !== "string" || typeof body.fileId !== "string" || typeof body.keep !== "boolean") {
    return Response.json({ error: "Invalid review." }, { status: 400 });
  }
  const notes = (await allNotes()).get(body.fileId);
  if (!notes?.some((h) => h.id === body.id)) return Response.json({ error: "Unknown highlight." }, { status: 404 });
  const prev = (await allReviews()).get(body.id);
  await putReview(body.id, body.fileId, body.keep ? keepInRotation(prev, todayFrom(body.today)) : retire(prev));
  return new Response(null, { status: 204 });
}
