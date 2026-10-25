import { requireOwner } from "@/lib/auth/session";
import { ownerLibrary } from "@/lib/owner-library";
import { isPlace, purge, setTriage } from "@/lib/triage";

const validIds = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length > 0 && ids.length <= 500 && ids.every((id) => typeof id === "string" && /^[\w.:-]{1,80}$/.test(id));

/**
 * The owner sorts their reading (lib/triage.ts): POST { ids, place?, seen?, trashed? } moves
 * things to the Inbox, Later or the Archive, marks them seen or unseen, or puts them in the Trash
 * (trashed: true) or takes them out (false).
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { ids, place, seen, trashed } = (await request.json().catch(() => ({}))) as { ids?: unknown; place?: unknown; seen?: unknown; trashed?: unknown };
  if (!validIds(ids) || (place !== undefined && !isPlace(place)) || (seen !== undefined && typeof seen !== "boolean") || (trashed !== undefined && typeof trashed !== "boolean")) {
    return Response.json({ error: "Invalid change." }, { status: 400 });
  }
  const { books } = await ownerLibrary();
  const byId = new Map(books.map((b) => [b.id, b]));
  const known = ids.filter((id) => byId.has(id));
  if (!known.length) return Response.json({ error: "Nothing to change." }, { status: 404 });
  await setTriage(
    known.map((id) => {
      const b = byId.get(id)!;
      return { id, current: { place: b.place, seen: b.seen, trashed: b.trashed } };
    }),
    { place: place as Parameters<typeof setTriage>[1]["place"], seen: seen as boolean | undefined, trashed: trashed as boolean | undefined },
  );
  return new Response(null, { status: 204 });
}

/** Deletes things in the Trash for good: DELETE { ids }. Answers with the ids deleted. */
export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };
  if (!validIds(ids)) return Response.json({ error: "Invalid ids." }, { status: 400 });
  const { books } = await ownerLibrary();
  const inTrash = new Set(books.filter((b) => b.trashed).map((b) => b.id));
  return Response.json({ deleted: await purge(ids.filter((id) => inTrash.has(id))) });
}
