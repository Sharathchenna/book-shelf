import { requireOwner } from "@/lib/auth/session";
import { getClipping } from "@/lib/data";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * One image from a clipped arXiv paper's HTML version, for the EPUB the browser builds.
 * Only files under that paper's own arxiv.org/html/<id> folder are fetched.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const clip = await getClipping(params.get("paperId") ?? "");
  const arxiv = clip?.kind === "paper" ? clip.paper?.arxiv : undefined;
  let url: URL;
  try {
    url = new URL(params.get("url") ?? "");
  } catch {
    return Response.json({ error: "Bad URL." }, { status: 400 });
  }
  if (!arxiv || url.protocol !== "https:" || url.host !== "arxiv.org" || !url.pathname.startsWith(`/html/${arxiv}`)) {
    return Response.json({ error: "Not part of this paper." }, { status: 403 });
  }

  const res = await fetch(url, { headers: { "User-Agent": "book-shelf/0.1 (personal reading room)" } });
  if (!res.ok) return new Response(null, { status: res.status === 404 ? 404 : 502 });
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/")) return new Response(null, { status: 415 });
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
