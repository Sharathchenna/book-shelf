import { fromCaptureToken, isOwner } from "@/lib/auth/session";
import { saveLink } from "@/lib/save";

/**
 * Saving a link from elsewhere: the iOS share-sheet shortcut (with the capture token) or a
 * signed-in browser. Takes JSON { url } or { text } (whatever the share sheet passed: the first
 * link in it is saved), with an optional note, and answers in a sentence fit for a notification.
 */
export async function POST(request: Request) {
  const token = await fromCaptureToken(request);
  if (!token && !(await isOwner())) {
    return reply("Not saved: the token is missing or out of date. Make a new one on the site.", 401);
  }
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; text?: unknown; note?: unknown };
  const shared = [body.url, body.text].filter((v): v is string => typeof v === "string").join(" ");
  const url = shared.match(/https?:\/\/[^\s<>"]+/)?.[0];
  if (!url || url.length > 2000) return reply("Not saved: there was no link in what was shared.", 400);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.slice(0, 2000) : undefined;

  try {
    const { clip, refreshed } = await saveLink(url, { note, ...(token ? { via: "phone" as const } : {}) });
    const what = clip.tweet ? `@${clip.tweet.handle}: ${clip.tweet.text}` : (clip.title ?? clip.url);
    return reply(`${refreshed ? "Already saved, refreshed" : "Saved"}. ${what.replace(/\s+/g, " ").slice(0, 120)}`);
  } catch (error) {
    return reply(`Not saved: ${(error as Error).message}.`, 422);
  }
}

const reply = (text: string, status = 200) => new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
