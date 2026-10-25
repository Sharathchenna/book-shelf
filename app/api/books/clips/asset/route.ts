import { requireOwner } from "@/lib/auth/session";

const MAX_BYTES = 20 * 1024 * 1024;
const PICTURE_AGENT = "Mozilla/5.0 (compatible; book-shelf-reader/0.1; personal reading shelf)";

/**
 * One picture from a clipped article, for the ebook the browser makes of it (the reader's pages
 * can't load images from other sites). Only https, only images, and only public addresses (the
 * Worker's `global_fetch_strictly_public` flag keeps it off private networks).
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  let url: URL;
  try {
    url = new URL(new URL(request.url).searchParams.get("url") ?? "");
  } catch {
    return Response.json({ error: "Bad URL." }, { status: 400 });
  }
  if (url.protocol !== "https:") return Response.json({ error: "Only https pictures." }, { status: 403 });

  // As a browser asks: some picture servers turn away a request that names no browser.
  const res = await fetch(url, { headers: { Accept: "image/webp,image/png,image/jpeg,image/*;q=0.8", "User-Agent": PICTURE_AGENT }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  if (!res?.ok) return new Response(null, { status: res?.status === 404 ? 404 : 502 });
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/")) return new Response(null, { status: 415 });
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
