import { verifyBlobToken } from "@/lib/auth/session";
import { getStorage, MAX_BOOK_BYTES } from "@/lib/storage";

/**
 * Stand-in for R2's presigned URLs when using local development storage.
 * Each request carries a short-lived token for exactly one key and action.
 */
async function authorise(request: Request, ctx: RouteContext<"/api/blob/[...key]">, action: "get" | "put") {
  const key = (await ctx.params).key.join("/");
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const storage = getStorage();
  if (storage.kind !== "local") return { error: Response.json({ error: "Not found." }, { status: 404 }) };
  const claims = await verifyBlobToken(token, key, action);
  if (!claims) return { error: Response.json({ error: "Link expired." }, { status: 403 }) };
  return { key, storage, claims };
}

const TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  jpg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};

export async function GET(request: Request, ctx: RouteContext<"/api/blob/[...key]">) {
  const auth = await authorise(request, ctx, "get");
  if ("error" in auth) return auth.error;
  const bytes = await auth.storage.getBytes(auth.key);
  if (!bytes) return Response.json({ error: "Not found." }, { status: 404 });
  const type = TYPES[auth.key.split(".").at(-1) ?? ""] ?? "application/octet-stream";
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: { "content-type": type, "cache-control": "private, max-age=900" },
  });
}

export async function PUT(request: Request, ctx: RouteContext<"/api/blob/[...key]">) {
  const auth = await authorise(request, ctx, "put");
  if ("error" in auth) return auth.error;
  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > (auth.claims.bytes ?? MAX_BOOK_BYTES)) {
    return Response.json({ error: "Larger than declared." }, { status: 413 });
  }
  await auth.storage.put(auth.key, body, request.headers.get("content-type") ?? "application/octet-stream");
  return new Response(null, { status: 200 });
}
