import { fromScheduler, requireOwner } from "@/lib/auth/session";
import { refreshSearch } from "@/lib/save";
import { syncGoodreads } from "@/lib/sync";

/**
 * Syncs the shelf from Goodreads into the database: the owner's Sync button, and the nightly cron
 * (worker.ts). Then brings the search index up to date. Returns what changed; the page shows it
 * on the next render.
 */
export async function POST(request: Request) {
  if (!fromScheduler(request)) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  try {
    const result = await syncGoodreads();
    // The shelf is synced either way; search catches up on the next run if this fails.
    const search = await refreshSearch().catch((error) => {
      console.error("Search index refresh failed", error);
      return null;
    });
    return Response.json({ ...result, search }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Goodreads sync failed", error);
    return Response.json({ error: (error as Error).message || "The sync failed." }, { status: 502 });
  }
}
