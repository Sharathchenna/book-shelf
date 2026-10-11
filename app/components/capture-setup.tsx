"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Saving from elsewhere, set up from the Add dialog: an iPhone share-sheet shortcut (which posts
 * to /api/capture with a capture token) and a bookmarklet for computers (which opens Add here
 * with the page's link filled in).
 */
export function CaptureSetup({ onBack }: { onBack: () => void }) {
  const [created, setCreated] = useState<string | null | undefined>(undefined);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [error, setError] = useState("");
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  const origin = typeof window === "undefined" ? "" : window.location.origin;

  useEffect(() => {
    let current = true;
    fetch("/api/capture/token")
      .then((res) => (res.ok ? (res.json() as Promise<{ created: string | null }>) : { created: null }))
      .then((data) => current && setCreated(data.created))
      .catch(() => current && setCreated(null));
    return () => {
      current = false;
    };
  }, []);

  // React refuses javascript: URLs in markup, so the bookmarklet's link is set directly.
  useEffect(() => {
    const code = `(()=>{window.open(${JSON.stringify(`${origin}/?add=`)}+encodeURIComponent(location.href),"shelf-add","width=560,height=760")})()`;
    bookmarklet.current?.setAttribute("href", `javascript:${code}`);
  }, [origin]);

  const makeToken = async () => {
    if (created && !confirm("Make a new token? The shortcut stops working until you paste the new one into it.")) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/capture/token", { method: "POST" }).catch(() => null);
    const data = ((await res?.json().catch(() => null)) ?? {}) as { token?: string; created?: string };
    setBusy(false);
    if (!res?.ok || !data.token) return setError("Couldn't make a token. Are you still signed in?");
    setToken(data.token);
    setCreated(data.created ?? new Date().toISOString());
  };

  const turnOff = async () => {
    if (!confirm("Turn off saving from the shortcut? It stops working until you make a new token.")) return;
    await fetch("/api/capture/token", { method: "DELETE" }).catch(() => null);
    setToken("");
    setCreated(null);
  };

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text).catch(() => null);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? "" : c)), 1500);
  };

  const endpoint = `${origin}/api/capture`;

  return (
    <div className="flex max-h-[80vh] flex-col gap-5 overflow-y-auto">
      <div>
        <button type="button" onClick={onBack} className="mb-2 text-sm text-muted hover:text-fg">
          ← Add a link
        </button>
        <h2 className="font-serif text-3xl">Save from anywhere</h2>
        <p className="mt-1 text-sm text-muted">
          Send a post from X (or any link) here in two taps. Each one is read, summarised and indexed, so search finds it by what it&apos;s about.
        </p>
      </div>

      <section className="space-y-3">
        <h3 className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">iPhone and iPad: share sheet</h3>
        <div className="rounded-2xl bg-chip p-4 text-sm">
          {token ? (
            <>
              <p className="font-medium">Your token. Copy it now: it&apos;s only shown once.</p>
              <div className="mt-2 flex gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-bg px-3 py-2 font-mono text-xs">{token}</code>
                <button type="button" onClick={() => copy("token", `Bearer ${token}`)} className="shrink-0 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-ink-fg">
                  {copied === "token" ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="mt-2 text-xs text-muted">Copies with &quot;Bearer &quot; in front, ready for the shortcut&apos;s header.</p>
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-muted">
                {created === undefined
                  ? "Checking…"
                  : created
                    ? `A token is active (made ${new Date(created).toLocaleDateString()}).`
                    : "First, make a token for the shortcut."}
              </p>
              <button type="button" onClick={makeToken} disabled={busy || created === undefined} className="rounded-full bg-ink px-4 py-2 text-xs font-medium text-ink-fg disabled:opacity-60">
                {busy ? "Making…" : created ? "Make a new token" : "Make a token"}
              </button>
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed marker:text-muted">
          <li>
            In the <b>Shortcuts</b> app, make a new shortcut called <b>Save to Shelf</b>. In its details (ⓘ), turn on <b>Show in Share Sheet</b>.
          </li>
          <li>
            Add <b>Get Contents of URL</b>:
            <ul className="mt-1.5 space-y-1 text-muted">
              <li className="flex flex-wrap items-center gap-1.5">
                URL <code className="rounded bg-chip px-1.5 py-0.5 font-mono text-xs text-fg">{endpoint}</code>
                <button type="button" onClick={() => copy("url", endpoint)} className="text-xs text-accent hover:underline">
                  {copied === "url" ? "copied" : "copy"}
                </button>
              </li>
              <li>
                Method <b className="text-fg">POST</b>. Headers: <code className="rounded bg-chip px-1.5 py-0.5 font-mono text-xs text-fg">Authorization</code> = the token you copied.
              </li>
              <li>
                Request Body <b className="text-fg">JSON</b>, with a Text field <code className="rounded bg-chip px-1.5 py-0.5 font-mono text-xs text-fg">text</code> = <b className="text-fg">Shortcut Input</b>.
              </li>
            </ul>
          </li>
          <li>
            Add <b>Show Notification</b> with <b>Contents of URL</b>, so you see what was saved.
          </li>
          <li>
            In X, tap <b>Share</b> on a post → <b>Share via…</b> → <b>Save to Shelf</b>. It works from Safari and other apps too.
          </li>
        </ol>
        {created && !token && (
          <button type="button" onClick={turnOff} className="text-xs text-muted hover:text-red-600">
            Turn off the shortcut&apos;s access
          </button>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-[11px] font-medium tracking-[0.14em] text-muted uppercase">On a computer: bookmarklet</h3>
        <p className="text-sm text-muted">
          Drag this to your bookmarks bar. On any page (a post on X included), click it to save that page here, with a note if you like.
        </p>
        <a
          ref={bookmarklet}
          onClick={(e) => e.preventDefault()}
          draggable
          className="inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-fg"
        >
          + Save to Shelf
        </a>
      </section>
    </div>
  );
}
