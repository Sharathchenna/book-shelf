"use client";

import { useEffect, useRef, useState } from "react";
import { useOptionalShelf } from "./shelf-provider";

type State =
  | { stage: "idle" }
  | { stage: "syncing" }
  | { stage: "done" }
  | { stage: "failed"; url?: string; message?: string };

const POLL_MS = 4000;
const GIVE_UP_MS = 6 * 60_000;

/**
 * "Sync now", for the signed-in owner: runs the Goodreads sync on GitHub and follows it. A sync
 * that changed anything commits, and that redeploys the site a couple of minutes later.
 */
export function SyncButton() {
  const owner = useOptionalShelf()?.library?.owner;
  const [state, setState] = useState<State>({ stage: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!owner) return null;

  const sync = async () => {
    const started = Date.now();
    setState({ stage: "syncing" });
    const res = await fetch("/api/sync", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      const { error } = ((await res?.json().catch(() => ({}))) ?? {}) as { error?: string };
      setState({ stage: "failed", message: error ?? "Couldn't reach the server." });
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
        setState(run.conclusion === "success" ? { stage: "done" } : { stage: "failed", url: run.url });
      } else if (Date.now() - started > GIVE_UP_MS) {
        setState({ stage: "failed", url: run?.url, message: "Still running; check GitHub." });
      } else {
        timer.current = setTimeout(poll, POLL_MS);
      }
    };
    timer.current = setTimeout(poll, POLL_MS);
  };

  const label =
    state.stage === "syncing"
      ? "Syncing from Goodreads…"
      : state.stage === "done"
        ? "Synced · changes go live in about 2 min"
        : state.stage === "failed"
          ? (state.message ?? "Sync failed")
          : "Sync from Goodreads";

  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden>·</span>
      <button
        onClick={() => void sync()}
        disabled={state.stage === "syncing"}
        className="inline-flex items-center gap-1 underline-offset-4 hover:text-fg hover:underline disabled:no-underline"
      >
        <svg
          viewBox="0 0 24 24"
          className={`size-3 ${state.stage === "syncing" ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4" />
        </svg>
        <span aria-live="polite">{label}</span>
      </button>
      {state.stage === "failed" && state.url && (
        <a href={state.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-fg">
          details
        </a>
      )}
    </span>
  );
}
