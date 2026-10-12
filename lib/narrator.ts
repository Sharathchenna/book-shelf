import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * The narrator's GPU voice (narrator-server/): Kokoro on a GPU machine, which the Worker reaches
 * through a Cloudflare Tunnel with Workers VPC. Nothing else can reach it. It's optional: without
 * the binding, or while the machine is down, the reader's own voice in the browser reads instead.
 */

/** A request to the GPU server, or null when there's none or it doesn't answer in time. */
export async function askNarrator(path: string, init: RequestInit = {}, timeoutMs = 10_000): Promise<Response | null> {
  const { env } = await getCloudflareContext({ async: true });
  if (!env.NARRATOR) return null;
  try {
    // The VPC service fixes the host and port; the URL only carries the path.
    return await env.NARRATOR.fetch(`http://narrator${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    return null;
  }
}

/** Passes the GPU server's answer on, or says it isn't there. */
export function relay(res: Response | null): Response {
  if (!res) return Response.json({ error: "The narrator server isn't reachable." }, { status: 503 });
  const headers = new Headers({ "cache-control": "no-store" });
  for (const name of ["content-type", "x-sample-rate"]) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(res.body, { status: res.status, headers });
}
