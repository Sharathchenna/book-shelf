import Anthropic from "@anthropic-ai/sdk";
import { APIError } from "@typesafe-ai/sdk";
import { haikuEnabled, streamText } from "@/lib/ai/haiku";
import { jevEnabled, rankWithJev, type Ranked } from "@/lib/ai/jev";
import { answerPrompt, answerSystem, tasteContext } from "@/lib/ai/prompts";
import { bm25 } from "@/lib/search/bm25";
import { shelf } from "@/lib/shelf";
import { shelfConfig } from "@/shelf.config";

/** Shelves up to this size are ranked whole; bigger ones are narrowed by BM25 first. */
const RANK_ALL_UP_TO = 240;
const CANDIDATES = 120;
/** Books shown, and books Haiku is told about. */
const RESULTS = 24;
const EXPLAINED = 8;

const byId = new Map(shelf.items.map((i) => [i.id, i]));

// Per-instance safeguards; enough for a personal site. A shared store (KV/Redis) would be needed at scale.
const RATE = { windowMs: 60_000, max: 20 };
const hits = new Map<string, number[]>();
const rankings = new Map<string, Ranked[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE.windowMs);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RATE.max;
}

async function rank(query: string, mode: "ask" | "next"): Promise<Ranked[]> {
  const key = `${mode}:${query.toLowerCase()}`;
  const cached = rankings.get(key);
  if (cached) return cached;

  let ranked: Ranked[];
  if (mode === "next") {
    const unread = shelf.items.filter((i) => i.status === "to-read");
    ranked = await rankWithJev(unread.slice(0, CANDIDATES), {
      request: "Which of these unread books should the reader start next?",
      context: tasteContext(shelf.items),
      instructions:
        "Given the books the reader loved in `reader_context`, is {book} likely to be a great next read for them?",
    });
  } else {
    const pool = shelf.items.length <= RANK_ALL_UP_TO ? shelf.items : bm25(query, shelf.items, CANDIDATES);
    ranked = await rankWithJev(pool, { request: query });
  }

  ranked = ranked.slice(0, RESULTS);
  rankings.set(key, ranked);
  if (rankings.size > 200) rankings.delete(rankings.keys().next().value!);
  return ranked;
}

/**
 * "Ask the shelf". Streams plain text: the first line is the JSON ranking
 * ({ results: [{ id, match }], searched, ms }), then Haiku's answer as it is written.
 * 503 means AI search isn't configured; the client falls back to keyword search.
 */
export async function POST(request: Request) {
  if (!jevEnabled()) return Response.json({ error: "AI search is not configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as { query?: unknown; mode?: unknown };
  const mode = body.mode === "next" ? "next" : "ask";
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 300) : "";
  if (mode === "ask" && !query) return Response.json({ error: "Ask a question." }, { status: 400 });

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (rateLimited(ip)) return Response.json({ error: "Too many questions. Try again in a minute." }, { status: 429 });

  const started = performance.now();
  let ranked: Ranked[];
  try {
    ranked = await rank(query, mode);
  } catch (error) {
    console.error("Jev ranking failed", error);
    const status = error instanceof APIError && error.status === 429 ? 429 : 502;
    return Response.json({ error: "Search is having a moment. Try again shortly." }, { status });
  }

  const head = JSON.stringify({
    results: ranked,
    searched: mode === "next" ? shelf.items.filter((i) => i.status === "to-read").length : shelf.items.length,
    ms: Math.round(performance.now() - started),
  });
  const question = mode === "next" ? "What should I read next from the unread pile?" : query;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${head}\n`));
      if (haikuEnabled() && ranked.length) {
        try {
          await streamText(
            {
              max_tokens: 1024,
              output_config: { effort: "low" },
              // Too short to meet the minimum cacheable prefix, so no cache_control here.
              system: answerSystem(shelfConfig.owner),
              messages: [{ role: "user", content: answerPrompt(question, ranked.slice(0, EXPLAINED), byId) }],
            },
            (text) => controller.enqueue(encoder.encode(text)),
            request.signal,
          );
        } catch (error) {
          // The ranking already went out; the answer is a bonus, so a failure here just ends the stream.
          if (!(error instanceof Anthropic.APIUserAbortError)) console.error("Haiku answer failed", error);
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
