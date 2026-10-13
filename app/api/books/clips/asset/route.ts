import { requireOwner } from "@/lib/auth/session";

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * One picture from an X Article, for the ebook the browser makes of it (the reader's pages can't
 * load images from other sites). Only X's image host is fetched.
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
  if (url.protocol !== "https:" || url.host !== "pbs.twimg.com") return Response.json({ error: "Not an X picture." }, { status: 403 });

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return new Response(null, { status: res?.status === 404 ? 404 : 502 });
  const type = res.headers.get("content-type") ?? "application/octet-stream";
  if (!type.startsWith("image/")) return new Response(null, { status: 415 });
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return new Response(null, { status: 413 });
  return new Response(bytes, { headers: { "content-type": type, "cache-control": "private, max-age=3600" } });
}
