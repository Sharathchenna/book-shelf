import { requireOwner } from "@/lib/auth/session";
import { fishEnabled, fishSpeak } from "@/lib/fish";
import { validVoice } from "@/lib/library";
import { askNarrator, relay } from "@/lib/narrator";
import { isFishVoice, SPEECH_SAMPLE_RATE } from "@/lib/voices";

/**
 * What the reader can read with: `{ available }`, the GPU server; `{ fish }`, Fish Audio's
 * voices; `{ serverFish }`, whether the GPU server can save chapters in them too (it needs its
 * own copy of the key). `?warm=1` (when a Kokoro voice is wanted) gets its listening voice ready.
 */
export async function GET(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const warm = new URL(request.url).searchParams.get("warm") === "1";
  const res = await askNarrator(`/health${warm ? "?warm=1" : ""}`, {}, 4000);
  const health = res?.ok ? ((await res.json().catch(() => ({}))) as { fish?: boolean }) : null;
  return Response.json(
    { available: Boolean(health), fish: fishEnabled(), serverFish: health?.fish === true },
    { headers: { "cache-control": "no-store" } },
  );
}

/**
 * One sentence, as 16-bit mono PCM at the rate in `x-sample-rate`: a Fish voice from Fish Audio
 * (429 when it's busy, to try again shortly), a Kokoro voice from the GPU server.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  if (typeof body.voice !== "string" || !validVoice(body.voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 5000) {
    return Response.json({ error: "Invalid text." }, { status: 400 });
  }

  if (isFishVoice(body.voice)) {
    if (!fishEnabled()) return Response.json({ error: "Fish Audio isn't set up (FISH_API_KEY)." }, { status: 501 });
    const res = await fishSpeak(body.text, body.voice, AbortSignal.timeout(60_000)).catch(() => null);
    if (!res) return Response.json({ error: "Fish Audio didn't answer." }, { status: 504 });
    if (!res.ok) {
      const { message } = (await res.json().catch(() => ({}))) as { message?: string };
      // Busy (too many at once) and Fish's own trouble are worth trying again; the rest aren't.
      const status = res.status === 429 ? 429 : res.status >= 500 ? 502 : 422;
      return Response.json({ error: `Fish Audio: ${message ?? res.statusText}` }, { status });
    }
    return new Response(res.body, {
      headers: { "content-type": "application/octet-stream", "x-sample-rate": String(SPEECH_SAMPLE_RATE), "cache-control": "no-store" },
    });
  }

  const res = await askNarrator("/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: body.text, voice: body.voice }),
    // The listening voice may still be starting: it only holds the GPU while it's used.
  }, 90_000);
  return relay(res);
}
