import { fromScheduler, requireOwner } from "@/lib/auth/session";
import { syncGoodreads } from "@/lib/sync";

/**
 * Syncs the shelf from Goodreads into the database: the owner's Sync button, and the nightly cron
 * (worker.ts). Returns what changed; the page shows it on the next render.
 */
export async function POST(request: Request) {
  if (!fromScheduler(request)) {
    const denied = await requireOwner();
    if (denied) return denied;
  }
  try {
    return Response.json(await syncGoodreads(), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("Goodreads sync failed", error);
    return Response.json({ error: (error as Error).message || "The sync failed." }, { status: 502 });
  }
}
