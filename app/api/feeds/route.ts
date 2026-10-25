import { requireOwner } from "@/lib/auth/session";
import { listFeeds, listItems, subscribe, unsubscribe } from "@/lib/feeds";

/**
 * The owner's Feed (lib/feeds.ts): GET the feeds and their newest items; POST { url } subscribes
 * to a site (or a feed's own link); DELETE { id } unsubscribes.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const [feeds, items] = await Promise.all([listFeeds(), listItems()]);
  return Response.json({ feeds, items }, { headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { url } = (await request.json().catch(() => ({}))) as { url?: unknown };
  if (typeof url !== "string" || !url.trim() || url.length > 2000) return Response.json({ error: "Paste a site's or a feed's link." }, { status: 400 });
  try {
    return Response.json({ feed: await subscribe(url) });
  } catch (error) {
    return Response.json({ error: (error as Error).message || "Couldn't subscribe to that." }, { status: 422 });
  }
}

export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof id !== "string" || !/^[a-f0-9]{12}$/.test(id)) return Response.json({ error: "Unknown feed." }, { status: 400 });
  await unsubscribe(id);
  return new Response(null, { status: 204 });
}
