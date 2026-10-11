"use client";

import { Fragment, useEffect, useRef, useState } from "react";

/** Must match AI_ERROR_MARKER in app/api/reader/stream.ts. */
const ERROR_MARKER = "[[ai-error]]";
const KEEP = 40;

type Message = { role: "user" | "assistant"; content: string; quote?: string; error?: boolean };
export type ChatQuote = { text: string; image?: string };
export type Cite = { page?: number; section?: string };

const SUGGESTIONS = {
  paper: ["Explain this paper in plain words", "What's the key idea of this section?", "What are the main results?", "Walk me through the method"],
  book: ["Recap what's happened so far", "Who's who so far?", "What's this chapter about?", "What should I keep an eye on?"],
};

/**
 * The chat beside the reader. Claude sees the whole paper, or a book up to the reader's position,
 * plus their highlights. Each book keeps its own conversation on this device.
 */
export function ChatPanel({
  bookId,
  paper,
  onClose,
  getPosition,
  quote,
  onQuoteUsed,
  onCite,
}: {
  bookId: string;
  paper: boolean;
  onClose: () => void;
  getPosition: () => { sectionIndex: number; sectionFraction: number };
  /** A passage the reader chose to ask about (from the selection popover). */
  quote: ChatQuote | null;
  onQuoteUsed: () => void;
  /** Jumps to a page or section the answer cited. */
  onCite: (cite: Cite) => void;
}) {
  const storageKey = `reader-chat:${bookId}`;
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) ?? "[]") as Message[];
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!streaming) localStorage.setItem(storageKey, JSON.stringify(messages.slice(-KEEP)));
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, streaming, storageKey]);

  useEffect(() => {
    field.current?.focus();
  }, [quote]);

  useEffect(() => () => controller.current?.abort(), []);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || streaming) return;
    const asked: Message = { role: "user", content: question, ...(quote ? { quote: quote.text } : {}) };
    const history = [...messages.filter((m) => !m.error), asked];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const image = quote?.image;
    onQuoteUsed();

    const abort = new AbortController();
    controller.current = abort;
    const fail = (message: string) =>
      setMessages((list) => [...list.slice(0, -1), { role: "assistant", content: message, error: true }]);
    try {
      const res = await fetch("/api/reader/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          bookId,
          ...getPosition(),
          // Earlier quotes travel inside their questions; the newest goes separately, with its image.
          messages: history.map((m, i) => ({
            role: m.role,
            content: m.quote && i < history.length - 1 ? `About this passage: "${m.quote}"\n\n${m.content}` : m.content,
          })),
          quote: asked.quote,
          image,
        }),
      });
      if (!res.ok || !res.body) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        fail(error ?? "Something went wrong.");
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let answer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        answer += value;
        const shown = answer;
        setMessages((list) => [...list.slice(0, -1), { role: "assistant", content: shown }]);
      }
      if (answer.includes(ERROR_MARKER)) fail("Couldn't get an answer for that. Try again.");
    } catch (error) {
      if ((error as Error).name !== "AbortError") fail("Couldn't reach the server.");
    } finally {
      setStreaming(false);
    }
  };

  const clear = () => {
    controller.current?.abort();
    setMessages([]);
    localStorage.removeItem(storageKey);
  };

  return (
    <aside
      data-reader-ui
      role="dialog"
      aria-label="Chat"
      className="reader-surface reader-drawer fixed inset-3 z-50 flex flex-col rounded-3xl lg:left-auto lg:w-[26rem]"
    >
      <header className="flex items-center gap-2 px-5 pt-4 pb-2">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl leading-tight">Chat</h2>
          <p className="text-xs text-muted">{paper ? "Knows the whole paper and your highlights" : "Knows the book up to your page, no further"}</p>
        </div>
        {messages.length > 0 && (
          <button onClick={clear} className="rounded-full px-3 py-1.5 text-xs text-muted hover:bg-chip hover:text-fg">
            New chat
          </button>
        )}
        <button onClick={onClose} aria-label="Close chat" className="grid size-9 place-items-center rounded-full bg-chip hover:bg-line">
          ×
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-3" aria-live="polite">
        {messages.length === 0 && (
          <div className="pt-6">
            <p className="font-serif text-xl leading-snug text-balance">
              {paper ? "Ask anything about this paper." : "Ask anything about what you've read."}
            </p>
            <div className="mt-4 flex flex-col items-start gap-2">
              {SUGGESTIONS[paper ? "paper" : "book"].map((s) => (
                <button key={s} onClick={() => void send(s)} className="rounded-2xl bg-chip px-3.5 py-2 text-left text-sm hover:bg-line">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-8 flex flex-col items-end gap-1.5">
              {m.quote && (
                <blockquote className="line-clamp-3 border-r-2 border-accent pr-3 text-right font-serif text-sm text-muted italic">
                  {m.quote}
                </blockquote>
              )}
              <p className="rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[15px] leading-snug whitespace-pre-wrap text-ink-fg">{m.content}</p>
            </div>
          ) : (
            <div key={i} className={`text-[15px] leading-relaxed ${m.error ? "text-red-600 dark:text-red-400" : ""}`}>
              {m.content ? (
                <Markdown text={m.content.replace(ERROR_MARKER, "")} onCite={onCite} />
              ) : (
                <span className="inline-flex gap-1" aria-label="Thinking">
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="size-1.5 animate-pulse rounded-full bg-muted" style={{ animationDelay: `${d * 150}ms` }} />
                  ))}
                </span>
              )}
            </div>
          ),
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="border-t border-line px-3 pt-3 pb-3"
      >
        {quote && (
          <div className="mb-2 flex items-start gap-2 rounded-2xl bg-chip px-3 py-2">
            <p className="line-clamp-2 min-w-0 flex-1 font-serif text-sm text-muted italic">“{quote.text}”</p>
            <button type="button" onClick={onQuoteUsed} aria-label="Don't ask about this passage" className="text-muted hover:text-fg">
              ×
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={field}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder={quote ? "Ask about this passage…" : "Ask a question…"}
            aria-label="Message"
            className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-chip px-4 py-2.5 text-[15px] outline-none [field-sizing:content] focus:ring-2 focus:ring-accent/40"
          />
          <button
            disabled={streaming || !input.trim()}
            aria-label="Send"
            className="grid size-11 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-opacity disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <p className="mt-2 px-1 text-[11px] text-muted">Claude Haiku · check anything important against the text.</p>
      </form>
    </aside>
  );
}

/** The little Markdown the model is asked to use: paragraphs, "- " and "1." lists, **bold**, *italic*, `code`, and citations. */
function Markdown({ text, onCite }: { text: string; onCite: (cite: Cite) => void }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        const lines = block.split("\n").filter((l) => l.trim());
        if (lines.length && lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 marker:text-accent">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*[-*•]\s+/, "")} onCite={onCite} />
                </li>
              ))}
            </ul>
          );
        }
        if (lines.length && lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-1 pl-5 marker:text-muted">
              {lines.map((l, j) => (
                <li key={j}>
                  <Inline text={l.replace(/^\s*\d+[.)]\s+/, "")} onCite={onCite} />
                </li>
              ))}
            </ol>
          );
        }
        return (
          <p key={i}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                <Inline text={l.replace(/^#+\s+/, "")} onCite={onCite} />
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\((?:p|pp)\.\s?\d+(?:\s?[–-]\s?\d+)?\)|\(§\s?[\d.]+\))/g;

function Inline({ text, onCite }: { text: string; onCite: (cite: Cite) => void }) {
  return text.split(INLINE).map((part, i) => {
    if (i % 2 === 0) return part;
    if (part.startsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`")) return <code key={i} className="rounded bg-chip px-1 font-mono text-[0.9em]">{part.slice(1, -1)}</code>;
    if (part.startsWith("*")) return <em key={i}>{part.slice(1, -1)}</em>;
    const page = part.match(/\d+/)?.[0];
    const section = part.match(/§\s?([\d.]+)/)?.[1]?.replace(/\.$/, "");
    return (
      <button
        key={i}
        onClick={() => onCite(section ? { section } : { page: Number(page) })}
        className="rounded-md bg-accent/12 px-1 text-[0.92em] font-medium text-accent hover:bg-accent/20"
      >
        {part.slice(1, -1)}
      </button>
    );
  });
}
