import { requireOwner } from "@/lib/auth/session";
import { getClipping, saveClipping } from "@/lib/data";
import { getFile, listFiles, putFile } from "@/lib/library";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : undefined);

/**
 * The owner corrects what a clipping or a file of their own is called and who it's by, or writes
 * a note on the whole of it, as Readwise Reader's Edit metadata and document note do:
 * PATCH { title?, author?, note? } (an empty note removes it). A clipping's ebook takes its new
 * title and author too. A Goodreads book is edited on Goodreads.
 */
export async function PATCH(request: Request, ctx: RouteContext<"/api/docs/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { title?: unknown; author?: unknown; note?: unknown };
  const title = text(body.title, 300);
  const author = text(body.author, 200);
  const note = text(body.note, 4000);
  if (title === "" || (title === undefined && author === undefined && note === undefined)) {
    return Response.json({ error: "Nothing to change." }, { status: 400 });
  }

  const clip = await getClipping(id);
  if (clip) {
    await saveClipping({
      ...clip,
      ...(title !== undefined ? { title } : {}),
      ...(author !== undefined ? { author: author || undefined } : {}),
      ...(note !== undefined ? { note: note || undefined } : {}),
    });
    if (title !== undefined || author !== undefined) {
      for (const file of (await listFiles()).filter((f) => f.clipId === id || f.paperId === id)) {
        await putFile({ ...file, ...(title !== undefined ? { title } : {}), ...(author !== undefined ? { author } : {}) });
      }
    }
    return new Response(null, { status: 204 });
  }

  const file = await getFile(id);
  if (!file) return Response.json({ error: "Only an article, paper, post or a file of your own can be edited here." }, { status: 404 });
  await putFile({
    ...file,
    ...(title !== undefined ? { title } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(note !== undefined ? { note: note || undefined } : {}),
  });
  return new Response(null, { status: 204 });
}
