"use client";

import { useCallback, useRef, useState } from "react";

/** Must match AI_ERROR_MARKER in app/api/reader/stream.ts. */
const ERROR_MARKER = "[[ai-error]]";

export type AiState = {
  kind: "explain" | "recap";
  title: string;
  /** For "explain": the passage. */
  quote?: string;
  status: "streaming" | "done" | "error";
  text: string;
  error?: string;
};

/** Streams a reader AI response (plain text) into state, cancelling any previous one. */
export function useAiStream() {
  const [ai, setAi] = useState<AiState | null>(null);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (url: string, body: unknown, init: Omit<AiState, "status" | "text">) => {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setAi({ ...init, status: "streaming", text: "" });
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        setAi({ ...init, status: "error", text: "", error: error ?? "Something went wrong." });
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += value;
        setAi({ ...init, status: "streaming", text });
      }
      if (text.includes(ERROR_MARKER)) {
        setAi({ ...init, status: "error", text: "", error: "Couldn't get an answer for that. Try again." });
      } else {
        setAi({ ...init, status: "done", text });
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setAi({ ...init, status: "error", text: "", error: "Couldn't reach the server." });
      }
    }
  }, []);

  const close = useCallback(() => {
    controller.current?.abort();
    setAi(null);
  }, []);

  return { ai, run, close };
}

export function AiCard({
  ai,
  onClose,
  onSaveNote,
  right,
}: {
  ai: AiState;
  onClose: () => void;
  onSaveNote?: (text: string) => void;
  /** Distance from the right edge, to sit clear of the open chat. */
  right?: string;
}) {
  // Fact-check ends with the pages it cited; Related answers as a list.
  const [body, sourceText] = ai.text.split("\n\nSources:\n");
  const sources = (sourceText ?? "")
    .split("\n")
    .map((line) => line.replace(/^-\s*/, "").match(/^(.*)\s(https?:\/\/\S+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m));
  const listed = ai.kind === "recap" || /^\s*- /.test(body);
  const lines = listed ? body.split("\n").filter((l) => l.trim()) : null;

  return (
    <aside
      role="dialog"
      aria-label={ai.title}
      className="reader-surface reader-pop fixed right-4 bottom-24 z-50 flex max-h-[min(70dvh,34rem)] w-[min(26rem,calc(100%-2rem))] flex-col rounded-3xl"
      style={right ? { right } : undefined}
    >
      <header className="flex items-center justify-between gap-3 px-5 pt-4">
        <p className="flex items-center gap-2 text-xs font-medium tracking-[0.14em] text-muted uppercase">
          <span className={`size-1.5 rounded-full bg-accent ${ai.status === "streaming" ? "animate-pulse" : ""}`} />
          {ai.title}
        </p>
        <button onClick={onClose} aria-label="Close" className="grid size-8 place-items-center rounded-full bg-chip hover:bg-line">
          ×
        </button>
      </header>

      <div className="overflow-y-auto px-5 pt-3 pb-5">
        {ai.quote && (
          <blockquote className="mb-3 line-clamp-3 border-l-2 border-accent pl-3 font-serif text-[15px] text-muted italic">
            {ai.quote}
          </blockquote>
        )}
        {ai.status === "error" ? (
          <p className="text-sm text-muted">{ai.error}</p>
        ) : !ai.text ? (
          <div className="space-y-2" aria-hidden>
            <div className="h-3 w-11/12 animate-pulse rounded bg-chip" />
            <div className="h-3 w-9/12 animate-pulse rounded bg-chip" />
            <div className="h-3 w-10/12 animate-pulse rounded bg-chip" />
          </div>
        ) : lines ? (
          <ul className="space-y-2.5 text-[15px] leading-relaxed">
            {lines.map((line, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="mt-2.5 size-1 shrink-0 rounded-full bg-accent" />
                <span>{line.replace(/^[-•*]\s*/, "")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[15px] leading-relaxed whitespace-pre-line">{body}</p>
        )}
        {sources.length > 0 && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs">
            {sources.map(([, title, url]) => (
              <li key={url} className="truncate">
                <a href={url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                  {title}
                </a>{" "}
                <span className="text-muted">{new URL(url).hostname.replace(/^www\./, "")}</span>
              </li>
            ))}
          </ul>
        )}

        {ai.status === "done" && onSaveNote && (
          <button onClick={() => onSaveNote(ai.text)} className="pill mt-4 text-xs">
            Save as note
          </button>
        )}
        <p className="mt-4 text-[11px] text-muted">
          {sources.length
            ? "Claude Haiku, with a web search. Check anything important."
            : "Claude Haiku, using only the pages you've read. Check anything important."}
        </p>
      </div>
    </aside>
  );
}
