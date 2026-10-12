import { requireOwner } from "@/lib/auth/session";
import { validVoice } from "@/lib/library";
import { askNarrator, relay } from "@/lib/narrator";

/** Whether the GPU voice is there to read with: `{ available }`. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  const res = await askNarrator("/health", {}, 4000);
  return Response.json({ available: Boolean(res?.ok) }, { headers: { "cache-control": "no-store" } });
}

/** One sentence spoken by the GPU voice, as 16-bit mono PCM at the rate in `x-sample-rate`. */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; voice?: unknown };
  if (typeof body.voice !== "string" || !validVoice(body.voice)) return Response.json({ error: "Unknown voice." }, { status: 400 });
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 5000) {
    return Response.json({ error: "Invalid text." }, { status: 400 });
  }
  const res = await askNarrator("/speak", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: body.text, voice: body.voice }),
  });
  return relay(res);
}
