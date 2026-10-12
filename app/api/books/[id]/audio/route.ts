import { requireOwner } from "@/lib/auth/session";
import { getFile, listAudio, validVoice } from "@/lib/library";

/** Which chapters of a book are read aloud, and saved, in a voice: `?voice=af_heart`. */
export async function GET(request: Request, ctx: RouteContext<"/api/books/[id]/audio">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const voice = new URL(request.url).searchParams.get("voice") ?? "";
  if (!validVoice(voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  if (!(await getFile(id))) return Response.json({ error: "Unknown book." }, { status: 404 });
  return Response.json({ sections: await listAudio(id, voice) }, { headers: { "cache-control": "no-store" } });
}
