import { requireOwner } from "@/lib/auth/session";
import { isTopic } from "@/lib/bookcase";
import { setShelving } from "@/lib/shelving";

/** The owner moves a book or clipping on the bookcase: POST { id, topic?, favorite? }. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id, topic, favorite } = (await request.json().catch(() => ({}))) as { id?: unknown; topic?: unknown; favorite?: unknown };
  if (typeof id !== "string" || !/^[\w.:-]{1,80}$/.test(id) || (topic !== undefined && (!isTopic(topic) || topic === "unsorted")) || (favorite !== undefined && typeof favorite !== "boolean")) {
    return Response.json({ error: "Invalid shelving." }, { status: 400 });
  }
  await setShelving(id, { topic: topic as Parameters<typeof setShelving>[1]["topic"], favorite: favorite as boolean | undefined });
  return new Response(null, { status: 204 });
}
