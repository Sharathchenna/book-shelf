"use client";

import { useState } from "react";
import type { Item } from "@/lib/types";
import { Cover } from "./cover";
import { useShelf } from "./shelf-provider";

export type Ranked = { id: string; match: number };

export type Answer = {
  status: "loading" | "streaming" | "done" | "error";
  question: string;
  results: Ranked[];
  /** Haiku's answer so far, with [[id]] book references. */
  text: string;
  searched?: number;
  ms?: number;
  error?: string;
};

const SHOWN = 12;

export function AnswerPanel({ answer, onClose }: { answer: Answer; onClose: () => void }) {
  const { items, openBook } = useShelf();
  const [copied, setCopied] = useState(false);
  const byId = new Map(items.map((i) => [i.id, i]));
  const results = answer.results
    .map((r) => ({ ...r, item: byId.get(r.id) }))
    .filter((r): r is Ranked & { item: Item } => Boolean(r.item))
    .slice(0, SHOWN);
  const ids = results.map((r) => r.id);

  const share = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <section aria-live="polite" aria-busy={answer.status === "loading"} className="glass rise mx-auto mt-10 w-full max-w-5xl rounded-[28px] p-5 text-left sm:p-7">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-[0.14em] text-muted uppercase">You asked</p>
          <h2 className="mt-1 font-serif text-2xl leading-tight sm:text-3xl">{answer.question}</h2>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {answer.status === "done" && (
            <button onClick={share} className="pill">
              {copied ? "Link copied" : "Share"}
            </button>
          )}
          <button onClick={onClose} aria-label="Close results" className="grid size-9 place-items-center rounded-full bg-chip hover:bg-line">
            ×
          </button>
        </div>
      </header>

      {answer.status === "error" ? (
        <p className="mt-5 text-muted">{answer.error}</p>
      ) : (
        <>
          <AnswerText answer={answer} byId={byId} onOpen={(id) => openBook(id, ids)} />

          <ul className="mt-6 grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6">
            {answer.status === "loading"
              ? Array.from({ length: 6 }, (_, i) => (
                  <li key={i} aria-hidden>
                    <div className="aspect-[2/3] animate-pulse rounded-md bg-chip" style={{ animationDelay: `${i * 90}ms` }} />
                    <div className="mt-3 h-3 w-3/4 animate-pulse rounded bg-chip" />
                  </li>
                ))
              : results.map(({ id, match, item }) => (
                  <li key={id}>
                    <button onClick={() => openBook(id, ids)} className="group w-full text-left">
                      <Cover item={item} tilt className="transition-transform duration-300 group-hover:-translate-y-1" />
                      <p className="mt-2.5 line-clamp-2 text-sm leading-snug font-semibold">{item.title}</p>
                      <p className="truncate text-xs text-muted">{item.author}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-chip">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(match * 100)}%` }} />
                        </span>
                        <span className="text-[11px] text-muted tabular-nums">{Math.round(match * 100)}%</span>
                      </div>
                    </button>
                  </li>
                ))}
          </ul>
        </>
      )}

      <p className="mt-6 text-xs text-muted">
        {answer.status === "loading"
          ? "Jev is reading the shelf…"
          : answer.searched !== undefined &&
            `Ranked by Jev across ${answer.searched.toLocaleString("en-US")} books in ${((answer.ms ?? 0) / 1000).toFixed(1)}s · answer by Claude Haiku`}
      </p>
    </section>
  );
}

/** Haiku's answer, with each [[id]] rendered as a small cover chip that opens the book. */
function AnswerText({ answer, byId, onOpen }: { answer: Answer; byId: Map<string, Item>; onOpen: (id: string) => void }) {
  if (answer.status === "loading") {
    return (
      <div className="mt-5 space-y-2" aria-hidden>
        <div className="h-3.5 w-11/12 animate-pulse rounded bg-chip" />
        <div className="h-3.5 w-8/12 animate-pulse rounded bg-chip" />
      </div>
    );
  }
  if (!answer.text) return null;

  // Hide a reference that is still arriving ("[[gr12" at the very end of the stream).
  const text = answer.status === "streaming" ? answer.text.replace(/\[\[[^\]]*\]?$/, "") : answer.text;
  const parts = text.split(/\[\[([^\]]+)\]\]/);

  return (
    <p className="mt-5 max-w-3xl text-[17px] leading-relaxed">
      {parts.map((part, i) => {
        if (i % 2 === 0) return <span key={i}>{part}</span>;
        const item = byId.get(part);
        if (!item) return null;
        return (
          <button
            key={i}
            onClick={() => onOpen(item.id)}
            className="mx-0.5 inline-flex translate-y-0.5 items-center gap-1.5 rounded-full bg-chip py-0.5 pr-2.5 pl-1 align-baseline text-[15px] font-medium transition-colors hover:bg-line"
          >
            <Cover item={item} className="w-4 rounded-[2px] shadow-none" />
            <span className="max-w-56 truncate">{item.title}</span>
          </button>
        );
      })}
      {answer.status === "streaming" && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-accent align-middle" />}
    </p>
  );
}
