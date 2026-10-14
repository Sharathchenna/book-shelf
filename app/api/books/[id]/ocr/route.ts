import { haikuEnabled } from "@/lib/ai/haiku";
import { transcribePage } from "@/lib/ai/ocr";
import { requireOwner } from "@/lib/auth/session";
import { getFile } from "@/lib/library";

/** A JPEG of one page, as base64. */
const MAX_IMAGE_CHARS = 4_000_000;

/**
 * Reads one scanned page of a PDF: POST { image } (the page rendered in the browser) → { text }.
 * Nothing is stored here; the reader sends what it read to /text, a few pages at a time.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/books/[id]/ocr">) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });
  const { id } = await ctx.params;
  const book = await getFile(id);
  if (book?.format !== "pdf") return Response.json({ error: "Unknown PDF." }, { status: 404 });
  const { image } = (await request.json().catch(() => ({}))) as { image?: unknown };
  if (typeof image !== "string" || !image.startsWith("/9j/") || image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "Send the page as a JPEG." }, { status: 400 });
  }
  try {
    return Response.json({ text: await transcribePage(image) });
  } catch (error) {
    console.error("Reading a scanned page failed", id, error);
    return Response.json({ error: "Couldn't read that page." }, { status: 502 });
  }
}
