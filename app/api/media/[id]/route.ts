import { requireOwner } from "@/lib/auth/session";
import { getClipping, saveClipping } from "@/lib/data";
import { cleanCues, putMediaText } from "@/lib/media";

/**
 * A video's captions, fetched by the app from the owner's own connection when YouTube turned the
 * server away (lib/media.ts): POST { transcript: [{ t, text }], description?, seconds?, language? }.
 * Kept beside the clipping, which then reads as its transcript.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/media/[id]">) {
  const denied = await requireOwner();
  if (denied) return denied;
  const { id } = await ctx.params;
  const clip = await getClipping(id);
  if (!clip?.media) return Response.json({ error: "That isn't a video or an episode." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { transcript?: unknown; description?: unknown; seconds?: unknown; language?: unknown };
  const transcript = cleanCues(body.transcript);
  if (!transcript) return Response.json({ error: "Invalid transcript." }, { status: 400 });
  const description = typeof body.description === "string" ? body.description.slice(0, 20_000) : undefined;
  const seconds = typeof body.seconds === "number" && body.seconds > 0 && body.seconds < 86_400 ? Math.round(body.seconds) : clip.media.seconds;
  await putMediaText(id, { description, transcript: transcript.length ? transcript : undefined, language: typeof body.language === "string" ? body.language.slice(0, 20) : undefined });
  await saveClipping({
    ...clip,
    excerpt: clip.excerpt ?? description?.split(/\n\s*\n/)[0].slice(0, 320),
    minutes: seconds ? Math.max(1, Math.round(seconds / 60)) : clip.minutes,
    media: { ...clip.media, seconds, transcript: transcript.length > 0 },
  });
  return new Response(null, { status: 204 });
}
