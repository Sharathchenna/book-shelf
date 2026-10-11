"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SyncResult } from "@/lib/sync";
import { useOwner } from "./use-owner";

type State = { stage: "idle" } | { stage: "syncing" } | { stage: "done"; note: string } | { stage: "failed"; note: string };

const NOTE_MS = 10_000;

/** "Sync" in the top bar, for the signed-in owner: pulls the shelf from Goodreads now. */
export function SyncButton() {
  const owner = useOwner();
  const router = useRouter();
  const [state, setState] = useState<State>({ stage: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!owner) return null;

  const sync = async () => {
    clearTimeout(timer.current);
    setState({ stage: "syncing" });
    const res = await fetch("/api/sync", { method: "POST" }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as Partial<SyncResult> & { error?: string };
    if (!res?.ok) {
      setState({ stage: "failed", note: data.error ?? "Couldn't reach the server." });
    } else {
      setState({ stage: "done", note: summary(data as SyncResult) });
      if (data.changed) router.refresh();
    }
    timer.current = setTimeout(() => setState({ stage: "idle" }), NOTE_MS);
  };

  const label = { idle: "Sync", syncing: "Syncing…", done: "Synced", failed: "Sync failed" }[state.stage];

  return (
    <div className="relative">
      <button
        onClick={() => void sync()}
        disabled={state.stage === "syncing"}
        title="Sync from Goodreads"
        aria-label="Sync from Goodreads"
        className="pill px-3 disabled:opacity-80"
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-4 ${state.stage === "syncing" ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
        </svg>
        <span className="hidden sm:inline">{label}</span>
      </button>
      {(state.stage === "done" || state.stage === "failed") && (
        <p role="status" className="reader-surface reader-pop absolute top-full right-0 mt-2 w-64 rounded-2xl px-4 py-3 text-xs leading-relaxed">
          {state.note}
        </p>
      )}
    </div>
  );
}

function summary(result: SyncResult): string {
  if (!result.changed) return `Up to date with Goodreads (${result.books} books).`;
  const parts = [
    result.added.length && `added ${result.added.length === 1 ? `“${result.added[0]}”` : `${result.added.length} books`}`,
    result.updated && `updated ${result.updated}`,
    result.removed.length && `removed ${result.removed.length}`,
  ].filter(Boolean);
  const text = parts.length ? `Synced: ${parts.join(", ")}.` : "Synced.";
  return result.pending ? `${text} ${result.pending} more will get covers on the next sync.` : text;
}
