"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CLIP_LABEL } from "@/lib/clippings";
import { fallbackColor, textOn } from "@/lib/color";
import type { SearchDoc } from "@/lib/search/site";
import { useOptionalShelf } from "./shelf-provider";
import { useOwner } from "./use-owner";

type Result = Omit<SearchDoc, "card" | "text"> & { match: number };

const GROUPS: { kind: Result["kind"]; label: string }[] = [
  { kind: "book", label: "Books" },
  ...(["paper", "article", "newsletter", "tweet"] as const).map((kind) => ({ kind, label: CLIP_LABEL[kind] })),
];
const EXAMPLES = ["papers about attention in transformers", "a slow-burn story with a twist", "essays on doing great work", "something about habits"];

/** "Search" in the top bar and ⌘K anywhere: one search, by meaning, across everything on the site. */
export function SearchPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Search everything" title="Search everything (⌘K)" className="pill px-3">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4" />
        </svg>
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-line px-1 text-[10px] text-muted lg:inline">⌘K</kbd>
      </button>
      {/* At the page root: the top bar's backdrop blur would otherwise trap a fixed overlay inside it. */}
      {open && createPortal(<Palette onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const shelf = useOptionalShelf();
  const owner = useOwner();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState<"idle" | "searching" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Searches as you type, a moment after you stop; a newer search cancels the one in flight.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("searching");
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q }),
          signal: abort.signal,
        });
        const data = (await res.json()) as { results?: Result[]; error?: string; ranked?: boolean };
        if (!res.ok) {
          setStatus("error");
          setMessage(data.error ?? "Search failed.");
          return;
        }
        setResults(data.results ?? []);
        setActive(0);
        setStatus("done");
        setMessage(data.ranked ? "Ranked by meaning" : "Keyword matches");
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setStatus("error");
          setMessage("Couldn't reach the server.");
        }
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query]);

  // Too short to search: the examples show, whatever an earlier search left behind.
  const idle = query.trim().length < 2;
  const shown = useMemo(() => (idle ? [] : results), [idle, results]);
  const state = idle ? "idle" : status;
  // Grouped by kind, in the site's order; the arrow keys walk the flattened list.
  const groups = useMemo(
    () => GROUPS.map((g) => ({ ...g, items: shown.filter((r) => r.kind === g.kind) })).filter((g) => g.items.length),
    [shown],
  );
  const flat = groups.flatMap((g) => g.items);

  const openResult = (result: Result) => {
    onClose();
    if (result.kind === "book") {
      const id = result.id.slice("book:".length);
      if (shelf) shelf.openBook(id);
      else router.push(result.href);
    } else if (owner && result.paperId) {
      router.push(`/reader/paper/${encodeURIComponent(result.paperId)}`);
    } else if (owner && result.articleId) {
      router.push(`/reader/clip/${encodeURIComponent(result.articleId)}`);
    } else {
      window.open(result.href, "_blank", "noopener,noreferrer");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!flat.length) return;
      const next = (active + (e.key === "ArrowDown" ? 1 : -1) + flat.length) % flat.length;
      setActive(next);
      list.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && flat[active]) {
      e.preventDefault();
      openResult(flat[active]);
    }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-50 bg-black/30 px-3 pt-[10vh] backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search everything"
        onKeyDown={onKeyDown}
        className="reader-surface reader-pop mx-auto flex max-h-[78vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl"
      >
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <svg viewBox="0 0 24 24" className={`size-5 shrink-0 text-muted ${state === "searching" ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4" />
          </svg>
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search books, papers, articles, newsletters, tweets…"
            aria-label="Search"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="search-results"
            aria-activedescendant={flat.length ? `search-result-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-lg outline-none placeholder:text-muted"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[11px] text-muted sm:inline">esc</kbd>
        </div>

        <div ref={list} id="search-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {state === "idle" && (
            <div className="px-3 py-4">
              <p className="text-sm text-muted">Describe what you&apos;re after, in your own words. Try:</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {EXAMPLES.map((example) => (
                  <button key={example} onClick={() => setQuery(example)} className="rounded-full bg-chip px-3 py-1.5 text-sm hover:bg-line">
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
          {state === "searching" && shown.length === 0 && <p className="px-3 py-6 text-sm text-muted">Searching by meaning…</p>}
          {state === "done" && shown.length === 0 && <p className="px-3 py-6 text-sm text-muted">Nothing on the site matches that.</p>}
          {state === "error" && <p className="px-3 py-6 text-sm text-red-600 dark:text-red-400">{message}</p>}

          {groups.map((group) => (
            <section key={group.kind} className="mb-2">
              <h3 className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[0.14em] text-muted uppercase">{group.label}</h3>
              {group.items.map((result) => {
                index++;
                const i = index;
                return (
                  <button
                    key={result.id}
                    id={`search-result-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => openResult(result)}
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left aria-selected:bg-chip"
                  >
                    <Thumb result={result} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{result.title}</span>
                      <span className="block truncate text-sm text-muted">{result.subtitle}</span>
                    </span>
                    <span className="hidden w-14 shrink-0 sm:block" title={`${Math.round(result.match * 100)}% match`}>
                      <span className="block h-1 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(result.match * 100)}%` }} />
                      </span>
                    </span>
                  </button>
                );
              })}
            </section>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-[11px] text-muted">
          <span>{state === "done" && shown.length ? `${shown.length} results · ${message}` : "Jev ranks by meaning, not just matching words"}</span>
          <span className="hidden sm:inline">↑↓ to move · ↵ to open</span>
        </div>
      </div>
    </div>
  );
}

/** A cover for books, the image or avatar for clippings, else a lettered tile in a stable colour. */
function Thumb({ result }: { result: Result }) {
  const [failed, setFailed] = useState(false);
  const book = result.kind === "book";
  const shape = book ? "h-12 w-8 rounded" : result.kind === "tweet" ? "size-9 rounded-full" : "size-9 rounded-lg";
  if (result.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={result.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} className={`${shape} shrink-0 bg-chip object-cover`} />
    );
  }
  const color = fallbackColor(result.title);
  return (
    <span className={`${shape} grid shrink-0 place-items-center font-serif text-sm`} style={{ background: color, color: textOn(color) }} aria-hidden>
      {result.title.replace(/^(the|a)\s+/i, "")[0]?.toUpperCase()}
    </span>
  );
}
