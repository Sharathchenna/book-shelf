"use client";

import { useEffect, useRef, useState } from "react";
import { useOptionalShelf } from "./shelf-provider";
import { useMe } from "./use-owner";

type State =
  | { stage: "idle" }
  | { stage: "syncing" }
  | { stage: "done" }
  | { stage: "failed"; url?: string; message: string };

const POLL_MS = 4000;
const GIVE_UP_MS = 6 * 60_000;
const NOTE_MS = 10_000;

/**
 * "Sync" in the top bar, for the signed-in owner: runs the Goodreads sync on GitHub and follows
 * it. A sync that changed anything commits, and that redeploys the site a couple of minutes later.
 */
export function SyncButton() {
  const shelf = useOptionalShelf();
  // On the home page the shelf provider already knows; elsewhere, ask.
  const me = useMe(Boolean(shelf));
  const owner = shelf ? shelf.library?.owner : me?.owner;
  const [state, setState] = useState<State>({ stage: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!owner) return null;

  const finish = (next: State) => {
    setState(next);
    timer.current = setTimeout(() => setState({ stage: "idle" }), NOTE_MS);
  };

  const sync = async () => {
    clearTimeout(timer.current);
    const started = Date.now();
    setState({ stage: "syncing" });
    const res = await fetch("/api/sync", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const { error } = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
      finish({ stage: "failed", message: error ?? "Couldn't reach the server." });
      return;
    }
    const poll = async () => {
      const status = await fetch("/api/sync")
        .then((r) => (r.ok ? (r.json() as Promise<{ run: { status: string; conclusion: string | null; createdAt: string; url: string } | null }>) : null))
        .catch(() => null);
      const run = status?.run;
      // GitHub takes a moment to list the new run; until then the latest one is an older run.
      const ours = run && Date.parse(run.createdAt) >= started - 10_000;
      if (ours && run.status === "completed") {
        finish(run.conclusion === "success" ? { stage: "done" } : { stage: "failed", url: run.url, message: "The sync failed." });
      } else if (Date.now() - started > GIVE_UP_MS) {
        finish({ stage: "failed", url: run?.url, message: "It's still running; check GitHub." });
      } else {
        timer.current = setTimeout(poll, POLL_MS);
      }
    };
    timer.current = setTimeout(poll, POLL_MS);
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
          {state.stage === "done" ? "Synced from Goodreads. Any changes go live in about 2 minutes." : state.message}{" "}
          {state.stage === "failed" && state.url && (
            <a href={state.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Details
            </a>
          )}
        </p>
      )}
    </div>
  );
}
