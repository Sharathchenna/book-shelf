import { requireOwner } from "@/lib/auth/session";
import { markAllSeen, markItems } from "@/lib/feeds";

/** Marks Feed items seen or unseen: POST { ids, seen }, or { all: true } for every unseen one. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { ids, seen, all } = (await request.json().catch(() => ({}))) as { ids?: unknown; seen?: unknown; all?: unknown };
  if (all === true) {
    await markAllSeen();
    return new Response(null, { status: 204 });
  }
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((id) => typeof id === "string" && /^[a-f0-9]{16}$/.test(id)) || typeof seen !== "boolean") {
    return Response.json({ error: "Invalid change." }, { status: 400 });
  }
  await markItems(ids as string[], seen);
  return new Response(null, { status: 204 });
}
