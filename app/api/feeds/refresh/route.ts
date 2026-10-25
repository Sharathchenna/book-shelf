import { fromScheduler, requireOwner } from "@/lib/auth/session";
import { refreshFeeds } from "@/lib/feeds";

/** Checks every feed for new items: hourly from the cron (worker.ts), and when the Feed is pulled to refresh. */
export async function POST(request: Request) {
  if (!fromScheduler(request)) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  return Response.json(await refreshFeeds(), { headers: { "cache-control": "no-store" } });
}
