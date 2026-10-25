import { haikuEnabled, streamText } from "@/lib/ai/haiku";
import { LIBRARY_CHAT_SYSTEM, librarySources } from "@/lib/ai/library-chat";
import { requireOwner } from "@/lib/auth/session";
import { aiResponse } from "../../reader/stream";

const MAX_MESSAGES = 20;

type Message = { role: "user" | "assistant"; content: string };

/**
 * Ask your whole library (lib/ai/library-chat.ts): POST { messages } streams the answer to the
 * last question, from the books and clippings nearest it, which come first in the `x-sources`
 * header (JSON, URI-encoded) so the app can show what it cites.
 */
export async function POST(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  if (!haikuEnabled()) return Response.json({ error: "AI isn't configured (ANTHROPIC_API_KEY)." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { messages?: unknown };
  const messages = Array.isArray(body.messages)
    ? (body.messages as Partial<Message>[])
        .filter((m): m is Message => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
        .slice(-MAX_MESSAGES)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
    : [];
  if (messages.at(-1)?.role !== "user") return Response.json({ error: "Ask something first." }, { status: 400 });
  while (messages[0]?.role === "assistant") messages.shift();

  const question = messages.at(-1)!.content;
  // What it was about before, too, so a follow-up ("and what about the second one?") finds the same things.
  const asked = messages.filter((m) => m.role === "user").slice(-3).map((m) => m.content).join("\n");
  const { sources, context } = await librarySources(asked);
  const turns = messages.slice(0, -1);
  const last = `Sources from my library for this question:\n\n${context || "(Nothing in the library matched.)"}\n\n---\n\nMy question: ${question}`;
  const response = aiResponse(request.signal, (write) =>
    streamText({ max_tokens: 2048, output_config: { effort: "low" }, system: LIBRARY_CHAT_SYSTEM, messages: [...turns, { role: "user", content: last }] }, write, request.signal),
  );
  response.headers.set("x-sources", encodeURIComponent(JSON.stringify(sources)));
  return response;
}
