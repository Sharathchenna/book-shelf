import { requireOwner } from "@/lib/auth/session";
import { getFile, keys, putFile } from "@/lib/library";
import { getJson, putJson } from "@/lib/storage";

/** A page with less text than this has no real text layer. Matches SCANNED_BELOW in scanned.ts. */
const EMPTY_BELOW = 20;

/**
 * Fills in pages of a PDF's text that its text layer didn't have: PATCH { pages: [{ page, text }] }
 * (0-based), from scanned pages read by /ocr. Only empty pages are filled, so nothing the PDF
 * itself said is replaced.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/books/[id]/text">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const book = await getFile(id);
  const sections = book && (await getJson<string[]>(keys.text(id)));
  if (!book || book.format !== "pdf" || !sections) return Response.json({ error: "Unknown PDF." }, { status: 404 });
  const { pages } = (await request.json().catch(() => ({}))) as { pages?: unknown };
  if (!Array.isArray(pages) || pages.length > 50) return Response.json({ error: "Send up to 50 pages." }, { status: 400 });

  let filled = 0;
  for (const p of pages as { page?: unknown; text?: unknown }[]) {
    if (!Number.isInteger(p.page) || typeof p.text !== "string") continue;
    const i = p.page as number;
    if (i < 0 || i >= sections.length || sections[i].trim().length >= EMPTY_BELOW || !p.text.trim()) continue;
    sections[i] = p.text.slice(0, 50_000);
    book.sections[i] = { ...book.sections[i], chars: sections[i].length };
    filled++;
  }
  if (filled) {
    await putJson(keys.text(id), sections);
    await putFile({ ...book, totalChars: sections.reduce((n, s) => n + s.length, 0) });
  }
  return Response.json({ filled });
}
