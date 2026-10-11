"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CLIP_KINDS, CLIP_LABEL, clipPath } from "@/lib/clippings";
import type { Clip, ClipKind } from "@/lib/types";
import { useOwner } from "./use-owner";

const KIND_NAME: Record<ClipKind, string> = { article: "Article", paper: "Paper", newsletter: "Newsletter", tweet: "Tweet" };

/**
 * "Add" in the top bar, for the signed-in owner: clip a link (article, paper, newsletter issue or
 * tweet) straight into the site. The server reads the link's details; the new clipping shows at once.
 */
export function AddClip() {
  const owner = useOwner();
  const [open, setOpen] = useState(false);
  if (!owner) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="Add a link" title="Add a link" className="pill px-3">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span className="hidden sm:inline">Add</span>
      </button>
      {/* At the page root: the top bar's backdrop blur would otherwise trap a fixed overlay inside it. */}
      {open && createPortal(<AddClipDialog onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function AddClipDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<ClipKind | "auto">("auto");
  const [note, setNote] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/clips", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url,
        kind: kind === "auto" ? undefined : kind,
        note,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      }),
    }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { clip?: Clip; error?: string };
    setBusy(false);
    if (!res?.ok || !data.clip) {
      setError(data.error ?? "Couldn't reach the server.");
      return;
    }
    onClose();
    router.push(clipPath(data.clip.kind));
    router.refresh();
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && !busy && onClose()}
    >
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label="Add a link"
        className="reader-surface reader-pop flex w-full max-w-md flex-col gap-4 rounded-[28px] p-6"
      >
        <div>
          <h2 className="font-serif text-3xl">Add a link</h2>
          <p className="mt-1 text-sm text-muted">An article, paper, newsletter issue or tweet. Its title, author and summary are filled in for you.</p>
        </div>

        <input
          ref={input}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
          inputMode="url"
          placeholder="https://… or arxiv:1706.03762 or a DOI"
          aria-label="Link"
          className="rounded-full bg-chip px-5 py-3 outline-none focus:ring-2 focus:ring-accent/40"
        />

        <fieldset className="flex flex-wrap gap-1.5">
          <legend className="sr-only">Kind</legend>
          {(["auto", ...CLIP_KINDS] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              aria-pressed={kind === k}
              className="rounded-full border border-line px-3 py-1.5 text-sm transition-colors aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-fg"
            >
              {k === "auto" ? "Detect" : KIND_NAME[k]}
            </button>
          ))}
        </fieldset>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Why it's worth keeping (optional)"
          aria-label="Note"
          className="resize-none rounded-2xl bg-chip px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags, separated by commas (optional)"
          aria-label="Tags"
          className="rounded-full bg-chip px-5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-accent/40"
        />

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-full px-4 py-2 text-sm text-muted hover:bg-chip">
            Cancel
          </button>
          <button disabled={busy || !url.trim()} className="rounded-full bg-ink px-5 py-2 text-sm font-medium text-ink-fg disabled:opacity-60">
            {busy ? "Reading the link…" : kind === "auto" ? "Add" : `Add to ${CLIP_LABEL[kind]}`}
          </button>
        </div>
      </form>
    </div>
  );
}
