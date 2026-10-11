"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { type Answer, AnswerPanel } from "./answer-panel";
import { useShelf } from "./shelf-provider";

export type Suggestion = { label: string; kind: "category" | "author" };

/** Example questions, for when AI search is available. */
const EXAMPLES = [
  "a slow-burn horror in a small town",
  "hopeful science fiction",
  "something short to finish this weekend",
  "the books that made the biggest impression",
];

const rise = (step: number) => ({ animationDelay: `${step * 80}ms` });

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

function setUrlQuery(q: string | null) {
  const url = new URL(window.location.href);
  if (q) url.searchParams.set("q", q);
  else url.searchParams.delete("q");
  window.history.replaceState(null, "", url);
}

/**
 * The hero: "ask the shelf". Jev ranks the shelf and Claude Haiku writes a short answer
 * (see /api/ask). When AI search isn't configured, it filters the library by keyword instead.
 * Shortcuts: "/" focuses the search box, "R" opens a random unread book.
 */
export function AskHero({ owner, suggestions }: { owner: string; suggestions: Suggestion[] }) {
  const { items, setQuery, setCategory, setColour, openBook } = useShelf();
  const [value, setValue] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Unknown until the first request; a 503 means no API keys, so fall back to keyword search.
  const [aiAvailable, setAiAvailable] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const inflight = useRef<AbortController | null>(null);

  const showLibrary = () => document.getElementById("library")?.scrollIntoView({ block: "start" });

  const keywordSearch = (text: string) => {
    setValue(text);
    setQuery(text.trim());
    setCategory(null);
    setColour(null);
    showLibrary();
  };

  const ask = async (question: string, mode: "ask" | "next" = "ask") => {
    const text = question.trim();
    if (mode === "ask" && !text) return;
    if (!aiAvailable && mode === "ask") return keywordSearch(text);

    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    const label = mode === "next" ? "What should I read next?" : text;
    setValue(mode === "ask" ? text : "");
    setAnswer({ status: "loading", question: label, results: [], text: "" });
    setUrlQuery(mode === "ask" ? text : null);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: text, mode }),
        signal: controller.signal,
      });
      if (response.status === 503) {
        setAiAvailable(false);
        setAnswer(null);
        setUrlQuery(null);
        if (mode === "ask") keywordSearch(text);
        return;
      }
      if (!response.ok || !response.body) {
        const { error } = (await response.json().catch(() => ({}))) as { error?: string };
        setAnswer({ status: "error", question: label, results: [], text: "", error: error ?? "Something went wrong." });
        return;
      }

      // First line: the JSON ranking. Everything after: the answer, as it streams.
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      let head: Pick<Answer, "results" | "searched" | "ms"> | null = null;
      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += chunk;
        if (!head) {
          const newline = buffer.indexOf("\n");
          if (newline < 0) continue;
          head = JSON.parse(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
        }
        setAnswer({ status: "streaming", question: label, ...head!, text: buffer });
      }
      if (head) setAnswer({ status: "done", question: label, ...head, text: buffer });
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      setAnswer({ status: "error", question: label, results: [], text: "", error: "Couldn't reach the shelf. Try again." });
    }
  };

  // A category suggestion selects that category, so its count matches the library's category button.
  const pick = ({ label, kind }: Suggestion) => {
    if (kind === "author") return keywordSearch(label);
    setValue("");
    setQuery("");
    setColour(null);
    setCategory(label);
    showLibrary();
  };

  const surprise = () => {
    const unread = items.filter((i) => i.status !== "read");
    const pool = unread.length ? unread : items;
    openBook(pool[Math.floor(Math.random() * pool.length)].id);
  };

  const close = () => {
    inflight.current?.abort();
    setAnswer(null);
    setUrlQuery(null);
  };

  const onShortcut = useEffectEvent((e: KeyboardEvent) => {
    if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
    if (e.key === "/") {
      e.preventDefault();
      input.current?.focus();
    } else if (e.key === "r" || e.key === "R") {
      surprise();
    }
  });

  // A shared ?q= link asks its question on arrival.
  const askFromUrl = useEffectEvent(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) void ask(q);
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the URL once on mount
    askFromUrl();
    const onKeyDown = (e: KeyboardEvent) => onShortcut(e);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      inflight.current?.abort();
    };
  }, []);

  const busy = answer?.status === "loading" || answer?.status === "streaming";

  return (
    <section className="flex flex-col items-center px-4 py-12 text-center sm:py-16">
      <div className="flex w-full max-w-3xl flex-col items-center">
        <h1 className="rise font-serif text-5xl leading-[0.95] tracking-tight sm:text-7xl" style={rise(0)}>
          What&apos;s on <em className="text-accent">{owner}&apos;s</em> shelf?
        </h1>
        <p className="rise mt-5 text-balance text-muted" style={rise(1)}>
          {items.length.toLocaleString("en-US")} books, read and waiting.{" "}
          {aiAvailable
            ? "Ask it anything: a mood, a theme, a half-remembered plot."
            : "Find one by title, author, subject or category."}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void ask(value);
          }}
          className="glass liquid rise mt-8 flex w-full items-center gap-2 rounded-full p-1.5 pl-6 transition-shadow focus-within:shadow-(--shadow-lifted)"
          style={rise(2)}
        >
          <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={300}
            placeholder={aiAvailable ? `${EXAMPLES[0]}…` : "Title, author or subject…"}
            aria-label="Search the shelf"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-lg outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded-md border border-line px-2 py-0.5 text-xs text-muted sm:block">/</kbd>
          <button
            aria-label={aiAvailable ? "Ask" : "Search"}
            disabled={busy}
            className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-ink-fg transition-transform hover:scale-105 active:scale-95 disabled:opacity-60"
          >
            {busy ? (
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </form>

        <ul className="rise mt-4 flex max-w-2xl flex-wrap justify-center gap-2" style={rise(3)} aria-label="Suggestions">
          {aiAvailable
            ? EXAMPLES.map((q) => (
                <li key={q}>
                  <button onClick={() => void ask(q)} className="rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent/40 hover:bg-chip hover:text-fg">
                    {q}
                  </button>
                </li>
              ))
            : suggestions.map((s) => (
                <li key={s.label}>
                  <button onClick={() => pick(s)} className="rounded-full border border-line px-3.5 py-1.5 text-sm text-muted transition-colors hover:border-accent/40 hover:bg-chip hover:text-fg">
                    {s.label}
                  </button>
                </li>
              ))}
        </ul>

        <div className="rise mt-6 flex flex-wrap items-center justify-center gap-3" style={rise(4)}>
          {aiAvailable && (
            <button
              onClick={() => void ask("", "next")}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-ink-fg transition-transform hover:scale-[1.03] active:scale-95"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
                <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
              </svg>
              Pick my next read
            </button>
          )}
          <button
            onClick={surprise}
            className={
              aiAvailable
                ? "pill"
                : "inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-ink-fg transition-transform hover:scale-[1.03] active:scale-95"
            }
          >
            Surprise me
          </button>
          <span className="hidden text-xs text-muted sm:inline">
            or press <kbd className="rounded border border-line px-1.5">R</kbd>
          </span>
        </div>
      </div>

      {answer && <AnswerPanel answer={answer} onClose={close} />}
    </section>
  );
}
