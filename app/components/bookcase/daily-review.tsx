"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { HighlightColor } from "@/lib/library-types";
import { HIGHLIGHT_HEX } from "../reader/foliate";
import { ArrowRight } from "./icons";

type Card = { id: string; fileId: string; text: string; note?: string; color: HighlightColor; title: string; author: string; href: string };

/** When the reader's day began, in their own time zone. */
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

/**
 * A few of your own highlights back on the library page each day, one at a time (lib/review.ts).
 * Keep one and it returns in a few days, then less and less often; mark it done and it leaves the
 * review. Only for the owner, and nothing at all until there are highlights from before today.
 */
export function DailyReview() {
  const [state, setState] = useState<{ deck: Card[]; done: number; total: number } | null>(null);

  useEffect(() => {
    let current = true;
    void fetch(`/api/review?today=${startOfToday()}`)
      .then((res) => (res.ok ? (res.json() as Promise<{ deck: Card[]; done: number; total: number }>) : null))
      .then((data) => current && data && setState(data))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  const card = state?.deck[0];
  if (!state || !card) return null;

  const seen = (keep: boolean) => {
    setState((s) => s && { ...s, deck: s.deck.slice(1), done: s.done + 1 });
    void fetch("/api/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: card.id, fileId: card.fileId, keep, today: startOfToday() }),
    }).catch(() => {});
  };

  return (
    <section aria-label="Today, from your highlights" className="lib-review">
      <p className="lib-review-label">
        Today, from your highlights
        {state.total > 1 && <span className="tabular-nums">{`${state.done + 1} of ${state.total}`}</span>}
      </p>
      <div key={card.id} className="lib-review-card">
        <Link href={card.href} className="group flex min-w-0 flex-1 flex-col">
          <blockquote className="lib-review-quote">
            <span style={{ ["--hl" as string]: HIGHLIGHT_HEX[card.color] }}>{card.text.trim()}</span>
          </blockquote>
          {card.note && <p className="mt-1.5 truncate text-[13.5px] text-ink-2">{card.note}</p>}
          <p className="lib-review-source">
            <span className="truncate">
              {card.title}
              {card.author ? `, ${card.author}` : ""}
            </span>
            <ArrowRight size={13} className="shrink-0 transition-transform group-hover:translate-x-0.5" />
          </p>
        </Link>
        <div className="lib-review-actions">
          <button type="button" onClick={() => seen(true)} title="Keep it coming back: in a few days, then less often" className="lib-review-next">
            Next
          </button>
          <button type="button" onClick={() => seen(false)} title="It stays a highlight, but leaves the review" className="lib-review-done">
            Done with it
          </button>
        </div>
      </div>
    </section>
  );
}
