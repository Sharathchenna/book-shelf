import { requireOwner } from "@/lib/auth/session";
import { shelfConfig } from "@/shelf.config";

/**
 * "Sync now": runs the Goodreads sync workflow on GitHub (.github/workflows/goodreads-sync.yml),
 * which commits any change to data/shelf.json; that push redeploys the site. Needs
 * GITHUB_SYNC_TOKEN: a fine-grained token for this repository with Actions read and write.
 */
const WORKFLOW = "goodreads-sync.yml";
let lastStart = 0;

function github(path: string, init?: RequestInit) {
  return fetch(`https://api.github.com/repos/${shelfConfig.githubRepo}/actions/workflows/${WORKFLOW}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GITHUB_SYNC_TOKEN}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "book-shelf-sync",
      ...init?.headers,
    },
  });
}

const notConfigured = () =>
  !process.env.GITHUB_SYNC_TOKEN || !shelfConfig.githubRepo
    ? Response.json({ error: "Syncing needs GITHUB_SYNC_TOKEN (and githubRepo in shelf.config.ts)." }, { status: 503 })
    : null;

/** The latest sync run: queued, in progress, or finished and how. */
export async function GET() {
  const denied = (await requireOwner()) ?? notConfigured();
  if (denied) return denied;
  const res = await github("/runs?per_page=1");
  if (!res.ok) return Response.json({ error: `GitHub answered ${res.status}.` }, { status: 502 });
  const { workflow_runs: [run] = [] } = (await res.json()) as {
    workflow_runs?: { status: string; conclusion: string | null; created_at: string; html_url: string }[];
  };
  return Response.json(
    { run: run ? { status: run.status, conclusion: run.conclusion, createdAt: run.created_at, url: run.html_url } : null },
    { headers: { "cache-control": "no-store" } },
  );
}

/** Starts a sync. */
export async function POST() {
  const denied = (await requireOwner()) ?? notConfigured();
  if (denied) return denied;
  // The workflow queues overlapping runs anyway; this just stops a double-click from starting two.
  if (Date.now() - lastStart < 30_000) return Response.json({ started: true });
  const res = await github("/dispatches", { method: "POST", body: JSON.stringify({ ref: "main" }) });
  if (!res.ok) {
    const hint = res.status === 401 || res.status === 403 || res.status === 404 ? " Check GITHUB_SYNC_TOKEN's access." : "";
    return Response.json({ error: `GitHub answered ${res.status}.${hint}` }, { status: 502 });
  }
  lastStart = Date.now();
  return Response.json({ started: true });
}
