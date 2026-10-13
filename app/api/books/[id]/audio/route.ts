import { requireOwner } from "@/lib/auth/session";
import { audioVoices, getFile, listAudio, validVoice } from "@/lib/library";

/**
 * Which chapters of a book are read aloud, and saved, in a voice: `?voice=af_heart`. Without a
 * voice, which voices it has chapters saved in: `{ voices: [{ voice, sections }] }`.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/books/[id]/audio">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const voice = new URL(request.url).searchParams.get("voice");
  if (voice !== null && !validVoice(voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  if (!(await getFile(id))) return Response.json({ error: "Unknown book." }, { status: 404 });
  const headers = { "cache-control": "no-store" };
  if (voice === null) return Response.json({ voices: await audioVoices(id) }, { headers });
  return Response.json({ sections: await listAudio(id, voice) }, { headers });
}
