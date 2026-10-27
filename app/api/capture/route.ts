import { fromCaptureToken, isOwner, requestDevice } from "@/lib/auth/session";
import { MAX_PAGE_CHARS, Refused, type SentPage } from "@/lib/clip";
import { backToInbox, saveLink } from "@/lib/save";

/**
 * Saving a link from elsewhere: the iOS share-sheet shortcut (with the capture token), the Android
 * app's share target (with its device token), or a signed-in browser. Takes JSON { url } or { text } (whatever the share sheet passed: the first
 * link in it is saved), with an optional note, and answers in a sentence fit for a notification.
 * A site that turns the server away is answered with the link in X-Shelf-Wants-Page; the app
 * fetches it itself and sends it again with `page: { html, url }`.
 */
export async function POST(request: Request) {
  const token = await fromCaptureToken(request);
  if (!token && !(await isOwner())) {
    return reply("Not saved: the token is missing or out of date. Make a new one on the site.", 401);
  }
  const body = (await request.json().catch(() => ({}))) as { url?: unknown; text?: unknown; note?: unknown; page?: { html?: unknown; url?: unknown } };
  const shared = [body.url, body.text].filter((v): v is string => typeof v === "string").join(" ");
  const url = shared.match(/https?:\/\/[^\s<>"]+/)?.[0];
  if (!url || url.length > 2000) return reply("Not saved: there was no link in what was shared.", 400);
  const note = typeof body.note === "string" && body.note.trim() ? body.note.slice(0, 2000) : undefined;
  const page: SentPage | undefined =
    typeof body.page?.html === "string" && body.page.html.length <= MAX_PAGE_CHARS
      ? { html: body.page.html, url: typeof body.page.url === "string" && /^https?:\/\//.test(body.page.url) ? body.page.url : undefined }
      : undefined;

  try {
    // From a phone (the shortcut, or the app's share sheet), so the library can show where it came from.
    const fromPhone = token || (await requestDevice()) !== null;
    const { clip, refreshed } = await saveLink(url, { note, page, ...(fromPhone ? { via: "phone" as const } : {}) });
    const back = refreshed && (await backToInbox(clip.id));
    const what = clip.tweet ? `@${clip.tweet.handle}: ${clip.tweet.text}` : (clip.title ?? clip.url);
    return reply(`${back ? "Already saved, back in the Inbox" : refreshed ? "Already saved, refreshed" : "Saved"}. ${what.replace(/\s+/g, " ").slice(0, 120)}`);
  } catch (error) {
    const wanted = error instanceof Refused && !page && URL.canParse(url) ? { "x-shelf-wants-page": new URL(url).href } : undefined;
    return reply(`Not saved: ${(error as Error).message}.`, 422, wanted);
  }
}

const reply = (text: string, status = 200, headers?: Record<string, string>) =>
  new Response(text, { status, headers: { "content-type": "text/plain; charset=utf-8", ...headers } });
