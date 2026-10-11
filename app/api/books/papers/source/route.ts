import { requireOwner } from "@/lib/auth/session";
import { getClipping } from "@/lib/data";

/**
 * A clipped arXiv paper's HTML version (arxiv.org/html/<id>), for the browser to turn into an
 * EPUB. Browsers can't fetch it from arXiv directly (no CORS). The final URL, after arXiv's
 * redirect to a version, comes back in x-source-url as the base for the paper's images.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const paperId = new URL(request.url).searchParams.get("paperId") ?? "";
  const clip = await getClipping(paperId);
  const arxiv = clip?.kind === "paper" ? clip.paper?.arxiv : undefined;
  if (!arxiv) return Response.json({ error: "Not an arXiv paper." }, { status: 404 });

  const res = await fetch(`https://arxiv.org/html/${arxiv}`, { headers: { "User-Agent": "book-shelf/0.1 (personal reading room)" } });
  const html = res.ok ? await res.text() : "";
  // arXiv answers 200 with a notice page when a paper has no HTML version.
  if (!html.includes("ltx_document")) return Response.json({ error: "This paper has no HTML version on arXiv." }, { status: 404 });
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "x-source-url": res.url, "cache-control": "no-store" },
  });
}
