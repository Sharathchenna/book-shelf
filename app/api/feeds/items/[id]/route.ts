import { requireOwner } from "@/lib/auth/session";
import { placeItem } from "@/lib/feeds";
import { isPlace } from "@/lib/triage";

/**
 * A Feed item opened or saved: POST { place } makes it a clipping (once) and leaves it in the
 * Feed ("feed", when it's only opened) or moves it to the library's Inbox, Later or Archive.
 * Answers with the clipping's id, to open it by.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/feeds/items/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const { place } = (await request.json().catch(() => ({}))) as { place?: unknown };
  if (!/^[a-f0-9]{16}$/.test(id) || !isPlace(place)) return Response.json({ error: "Invalid item." }, { status: 400 });
  try {
    return Response.json({ clipId: await placeItem(id, place) });
  } catch (error) {
    return Response.json({ error: `Couldn't open that: ${(error as Error).message}` }, { status: 422 });
  }
}
