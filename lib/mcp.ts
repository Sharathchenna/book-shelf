import "server-only";
import { fromCaptureToken } from "./auth/session";
import { fmtMinutes, TOPIC, TOPICS, isTopic, type ShelfBook } from "./bookcase";
import { saveLink } from "./save";
import { shelfBooks } from "./shelving";
import { shelfConfig } from "@/shelf.config";

/**
 * The shelf's MCP server (from Gloss's): an agent (Claude, Claude Code, any MCP client) saves
 * links to the shelf and looks through it. Streamable HTTP, stateless: every request is one
 * JSON-RPC message answered with JSON, with no session and no event stream.
 *
 * Auth is the same token as the phone shortcut (Add → Save from your phone), sent as
 * `Authorization: Bearer <token>` or as the last part of the URL (/mcp/<token>) for clients that
 * only take a URL. Like the shortcut, it can only add clippings; what it can read is what anyone
 * can see on the site.
 */

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const PER_CALL = 10;
const SITE = shelfConfig.siteUrl ?? "";

const INSTRUCTIONS = `This server is ${shelfConfig.owner}'s reading shelf: books from Goodreads, and the articles, papers, newsletter issues and posts they saved. Save links to it, and look through what's there.
Send each link as it is: articles, newsletter issues, arXiv and DOI links, and posts on X (the post's own link) are all read and saved. Each is summarised, sorted onto a topic, and searchable on the site at once.`;

const TOOLS = [
  {
    name: "save_links",
    title: "Save links to the shelf",
    description: `Save links to the reader's shelf: articles, essays, newsletter issues, papers (arXiv, DOI or a paper's page) and posts on X. The site reads each one, summarises it and sorts it onto a topic. Up to ${PER_CALL} links per call. A link already saved is refreshed. Returns what happened to each.`,
    inputSchema: {
      type: "object",
      properties: {
        urls: { type: "array", items: { type: "string" }, minItems: 1, maxItems: PER_CALL, description: "The links to save." },
        note: { type: "string", description: "Optional: why it's worth keeping, saved with each link." },
      },
      required: ["urls"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: "search_shelf",
    title: "Search the shelf",
    description:
      "Find books and saved reading on the shelf by words in the title, author, tags or summary, by topic, by kind, or by reading status. With no arguments, lists the most recently added.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for." },
        topic: { type: "string", enum: TOPICS.map((t) => t.key), description: "A topic key, from list_topics." },
        kind: { type: "string", enum: ["book", "paper", "article", "newsletter", "tweet"] },
        status: { type: "string", enum: ["unread", "reading", "finished"] },
        limit: { type: "integer", minimum: 1, maximum: 50, description: "At most this many (default 20)." },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "list_topics",
    title: "List the shelf's topics",
    description: "The shelf's topics, with how many books and clippings are on each.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version",
};

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });
const fail = (id: Rpc["id"], code: number, message: string, status = 200) => json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, status);

export function options() {
  return new Response(null, { status: 204, headers: CORS });
}

export function notAllowed() {
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export async function handle(request: Request, pathToken?: string): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(null, -32700, "Parse error: the body must be JSON-RPC.", 400);
  }
  // Clients on the 2025-03-26 protocol may send a batch: an array of messages, answered with an array.
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]) as Rpc[];
  if (!msgs.length || msgs.some((m) => typeof m !== "object" || !m)) return fail(null, -32600, "Send a JSON-RPC message, or an array of them.", 400);

  // A token in the URL is checked the same way as one in the header.
  const authorized = request.headers.get("authorization")
    ? await fromCaptureToken(request)
    : Boolean(pathToken) && (await fromCaptureToken(new Request(request.url, { headers: { authorization: `Bearer ${pathToken}` } })));
  if (!authorized) return fail(msgs[0].id, -32001, `Missing or out-of-date token. Make one on the site: Add → Save from your phone${SITE ? `, at ${SITE}` : ""}.`, 401);

  // Notifications get no answer; with nothing to answer, the reply is an empty 202.
  const answers = (await Promise.all(msgs.map(answer))).filter((a) => a !== null);
  if (!answers.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? answers : answers[0]);
}

async function answer(msg: Rpc): Promise<object | null> {
  if (msg.id === undefined || msg.method?.startsWith("notifications/")) return null;
  const ok = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: "2.0", id: msg.id ?? null, error: { code, message } });
  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "shelf", title: `${shelfConfig.owner}'s Shelf`, version: "1.0.0", ...(SITE ? { websiteUrl: SITE } : {}) },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        if (name === "save_links") return ok(await saveLinks(args));
        if (name === "search_shelf") return ok(await searchShelf(args));
        if (name === "list_topics") return ok(await listTopics());
        return err(-32602, `Unknown tool: ${name}`);
      } catch (e) {
        console.error("MCP tool failed", name, e);
        return ok(toolError(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    default:
      return err(-32601, `Method not found: ${msg.method}`);
  }
}

const toolError = (text: string) => ({ content: [{ type: "text", text }], isError: true });
const toolResult = (text: string, structured: Record<string, unknown>) => ({ content: [{ type: "text", text }], structuredContent: structured });

// ---- save_links ---------------------------------------------------------------------------------

type Saved = { url: string; status: "saved" | "refreshed" | "failed"; title?: string; reason?: string };

async function saveLinks(args: Record<string, unknown>) {
  const urls = [...new Set(Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0).map((u) => u.trim()) : [])];
  if (!urls.length) return toolError("Send at least one link in `urls`.");
  if (urls.length > PER_CALL) return toolError(`At most ${PER_CALL} links per call. Send the rest in another call.`);
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 2000) : undefined;

  const results: Saved[] = new Array(urls.length);
  // A few at a time: pages are slow, and one bad link never holds up the rest.
  let next = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let i = next++; i < urls.length; i = next++) {
        const url = urls[i];
        try {
          const { clip, refreshed } = await saveLink(url, { note, via: "agent" });
          const title = clip.title ?? (clip.tweet ? `@${clip.tweet.handle}: ${clip.tweet.text.replace(/\s+/g, " ").slice(0, 90)}` : clip.url);
          results[i] = { url, status: refreshed ? "refreshed" : "saved", title };
        } catch (error) {
          results[i] = { url, status: "failed", reason: (error as Error).message };
        }
      }
    }),
  );
  const count = (s: Saved["status"]) => results.filter((r) => r.status === s).length;
  const lines = results.map((r) => (r.status === "failed" ? `Not saved: ${r.url}. ${r.reason}` : `${r.status === "saved" ? "Saved" : "Already saved, refreshed"}: ${r.title}`));
  return toolResult(`${count("saved")} saved, ${count("refreshed")} refreshed, ${count("failed")} not saved.\n${lines.join("\n")}${SITE ? `\n\nThey're on the shelf at ${SITE}.` : ""}`, {
    saved: count("saved"),
    refreshed: count("refreshed"),
    failed: count("failed"),
    results,
  });
}

// ---- search_shelf, list_topics -------------------------------------------------------------------

const statusOf = (b: ShelfBook) => (b.pct >= 1 ? "finished" : b.pct > 0 ? "reading" : "unread");

function describe(b: ShelfBook) {
  return {
    title: b.title,
    author: b.author,
    kind: b.kind,
    topic: TOPIC[b.topic].name,
    tags: b.tags,
    length: fmtMinutes(b.minutes),
    status: statusOf(b),
    ...(b.rating ? { rating: b.rating } : {}),
    ...(b.url ? { url: b.url } : {}),
    ...(b.dek ? { about: b.dek } : {}),
    added: b.added ? new Date(b.added).toISOString().slice(0, 10) : undefined,
  };
}

async function searchShelf(args: Record<string, unknown>) {
  const words = String(args.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const topic = isTopic(args.topic) ? args.topic : null;
  const kind = typeof args.kind === "string" ? args.kind : null;
  const status = typeof args.status === "string" ? args.status : null;
  const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
  const { books } = await shelfBooks();
  const found = books
    .filter((b) => (!topic || b.topic === topic) && (!kind || b.kind === kind) && (!status || statusOf(b) === status))
    .filter((b) => words.every((w) => `${b.title} ${b.author} ${TOPIC[b.topic].name} ${b.tags.join(" ")} ${b.dek ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => b.added - a.added);
  const shown = found.slice(0, limit).map(describe);
  const text = shown.length
    ? `${found.length} found${found.length > shown.length ? `, showing ${shown.length}` : ""}:\n${shown
        .map((b) => `- ${b.title}${b.author ? `, ${b.author}` : ""} (${b.kind}, ${b.topic}, ${b.length}, ${b.status})${b.url ? ` ${b.url}` : ""}`)
        .join("\n")}`
    : "Nothing on the shelf matches.";
  return toolResult(text, { total: found.length, results: shown });
}

async function listTopics() {
  const { books } = await shelfBooks();
  const topics = TOPICS.map((t) => ({ key: t.key, name: t.name, count: books.filter((b) => b.topic === t.key).length })).filter((t) => t.count);
  return toolResult(topics.map((t) => `${t.name} (${t.key}): ${t.count}`).join("\n") || "The shelf is empty.", { topics });
}
