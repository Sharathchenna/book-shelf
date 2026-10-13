"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "./chrome";
import { RATES, VOICES, type Narrator, type NarratorState } from "./narrator";

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
};

const mb = (bytes: number) => Math.max(1, Math.round(bytes / 1e6));

/** "about 12 min left", rounded up so it never promises too soon. */
const timeLeft = (seconds: number) => {
  if (seconds < 50) return "less than a minute left";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 2) return "about a minute left";
  if (minutes < 90) return `about ${minutes} min left`;
  return `about ${Math.round(minutes / 60)} hours left`;
};

/** What the player says under the chapter title. */
function status(s: NarratorState): string {
  if (s.status === "error") return s.error ?? "Something went wrong.";
  // Shown while the model downloads; loading it from the browser's cache reports progress too, all at once.
  if (s.download && s.download.total && s.download.loaded < s.download.total) {
    return `Downloading the voice, once · ${mb(s.download.loaded)} of ${mb(s.download.total)} MB`;
  }
  const paused = s.status === "paused" ? "Paused · " : "";
  if (s.status === "loading") return "Starting…";
  if (s.waiting && !paused) return s.engine?.device === "wasm" ? "This device speaks slowly · next sentence coming…" : "Getting the next sentence ready…";
  if (s.time) return `${paused}${clock(s.time.at)} / ${clock(s.time.duration)}`;
  if (s.lines) return `${paused}Sentence ${s.line + 1} of ${s.lines}`;
  return paused ? "Paused" : "";
}

/** The narrator's controls, above the page while listening. */
export function ListenBar({
  narrator,
  chapter,
  raised,
  right,
  onClose,
}: {
  narrator: Narrator;
  /** Title of the chapter being read. */
  chapter: (section: number) => string;
  /** Sits above the reader's bottom bar while that's showing. */
  raised: boolean;
  right?: string;
  onClose: () => void;
}) {
  const s = useSyncExternalStore(narrator.subscribe, narrator.getState, narrator.getState);
  const [menu, setMenu] = useState(false);
  const playing = s.status === "playing" || s.status === "loading";
  const busy = (s.status === "loading" || s.waiting) && s.status !== "paused";
  const nextRate = RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] ?? 1;

  return (
    <div
      className="fixed inset-x-3 z-40 transition-[bottom] duration-300"
      style={{ bottom: raised ? "4.6rem" : "0.75rem", right }}
    >
      {menu && <ListenMenu narrator={narrator} state={s} chapter={chapter} onClose={() => setMenu(false)} />}
      <div className="reader-surface reader-pop mx-auto flex max-w-xl items-center gap-1 rounded-full py-1.5 pr-1.5 pl-2 sm:gap-2">
        <RoundButton label="Previous sentence" onClick={() => narrator.skip(-1)}>
          <Icon d="M11 7l-5 5 5 5M18 7l-5 5 5 5" />
        </RoundButton>
        <button
          onClick={() => narrator.toggle()}
          aria-label={playing ? "Pause" : "Play"}
          className="relative grid size-10 shrink-0 place-items-center rounded-full bg-ink text-ink-fg"
        >
          {busy && <span className="absolute inset-0 animate-spin rounded-full border-2 border-ink-fg/25 border-t-ink-fg" aria-hidden />}
          <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
            {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l11-6.5z" />}
          </svg>
        </button>
        <RoundButton label="Next sentence" onClick={() => narrator.skip(1)}>
          <Icon d="M6 7l5 5-5 5M13 7l5 5-5 5" />
        </RoundButton>

        <div className="min-w-0 flex-1 px-1">
          <p className="truncate font-serif text-[14px] leading-tight">{s.status === "off" ? "Listen" : chapter(s.section)}</p>
          <p className={`truncate text-[11px] tabular-nums ${s.status === "error" ? "text-red-600 dark:text-red-400" : "text-muted"}`}>
            {status(s)}
          </p>
        </div>

        {s.away && s.status !== "off" && (
          <button onClick={() => narrator.follow()} className="hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-medium hover:bg-chip sm:block">
            Back to reading
          </button>
        )}
        <button
          onClick={() => narrator.setRate(nextRate)}
          aria-label={`Speed ${s.rate}×, change to ${nextRate}×`}
          title="Speed"
          className="h-8 shrink-0 rounded-full px-2 text-xs font-semibold tabular-nums hover:bg-chip"
        >
          {s.rate}×
        </button>
        <span className="hidden sm:contents">
          <RoundButton label="Tap a sentence to read from it" active={s.tapToRead} onClick={() => narrator.setTapToRead(!s.tapToRead)}>
            <Icon d="M9 9l10 4.2-4.3 1.5L13.2 19zM4.5 4.5l1.8 1.8M9.5 3v2.5M3 9.5h2.5" />
          </RoundButton>
        </span>
        <RoundButton
          label="Voice and saving"
          active={menu}
          onClick={() => {
            // Saved counts, and any saving the GPU server is doing, as they are now.
            if (!menu) narrator.refresh();
            setMenu((m) => !m);
          }}
        >
          <Icon d="M4 8h10M18 8h2M4 16h4M12 16h8M14 6v4M8 14v4" />
        </RoundButton>
        <RoundButton
          label="Stop listening"
          onClick={() => {
            narrator.stop();
            onClose();
          }}
        >
          <Icon d="M6 6l12 12M18 6L6 18" />
        </RoundButton>
      </div>
    </div>
  );
}

function ListenMenu({
  narrator,
  state: s,
  chapter,
  onClose,
}: {
  narrator: Narrator;
  state: NarratorState;
  chapter: (section: number) => string;
  onClose: () => void;
}) {
  const fish = s.engine?.device === "fish";
  // Where chapters are saved: the GPU server (with the tab closed), or here.
  const server = s.engine?.device === "server" || (fish && Boolean(s.server));
  const noGpu = s.engine?.device === "wasm";
  const voice = VOICES.find((v) => v.id === s.voice);
  const saving = s.saving;
  const more = saving?.queued ? ` · ${saving.queued} more ${saving.queued === 1 ? "chapter" : "chapters"} to go` : "";
  return (
    <div role="dialog" aria-label="Voice and saving" className="reader-surface reader-pop mx-auto mb-2 max-w-xl rounded-[28px] p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Voice</p>
        <button onClick={onClose} aria-label="Close" className="grid size-7 place-items-center rounded-full hover:bg-chip">
          ×
        </button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {VOICES.map((v) => (
          <button
            key={v.id}
            onClick={() => narrator.setVoice(v.id)}
            aria-pressed={s.voice === v.id}
            className="rounded-2xl px-3 py-2 text-left transition-colors hover:bg-chip aria-pressed:bg-ink aria-pressed:text-ink-fg"
          >
            <span className="block text-sm font-medium">{v.name}</span>
            <span className="block text-[11px] opacity-70">
              {v.accent} · {v.maker}
            </span>
          </button>
        ))}
      </div>

      <p className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">Speed</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {RATES.map((r) => (
          <button
            key={r}
            onClick={() => narrator.setRate(r)}
            aria-pressed={s.rate === r}
            className="rounded-full px-2.5 py-1 text-sm tabular-nums hover:bg-chip aria-pressed:bg-ink aria-pressed:text-ink-fg"
          >
            {r}×
          </button>
        ))}
      </div>

      <Switch
        on={s.tapToRead}
        onChange={(on) => narrator.setTapToRead(on)}
        label="Tap to read from a sentence"
        detail="While listening, tapping a sentence on the page reads from there."
      />

      {voice?.maker === "Fish Audio" && (
        <Switch
          on={s.expressive}
          onChange={(on) => narrator.setExpressive(on)}
          label="Expressive reading"
          detail="A stressed word, a pause, a change of tone where a sentence calls for it, directed by Claude. Chapters saved before keep how they were read."
        />
      )}

      <p className="mt-4 text-xs font-semibold tracking-wide text-muted uppercase">Listen anywhere</p>
      <p className="mt-1.5 text-sm leading-snug">
        {s.saved} of {s.savable} chapters saved in this voice.{" "}
        <span className="text-muted">
          Saved chapters play instantly, on your phone too, with the lock-screen controls.{" "}
          {server ? "Chapters you listen to are saved as you listen." : "Chapters you listen to from their start are saved as they play."}
        </span>
      </p>
      {noGpu ? (
        <p className="mt-2 text-sm text-muted">This browser speaks without a GPU, so it can&apos;t save chapters. Open the book in Chrome or Safari on a computer to save it.</p>
      ) : saving ? (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-fg/20 border-t-accent" aria-hidden />
            <p className="min-w-0 flex-1 truncate text-sm">
              {saving.section === null ? (saving.remote ? "Sending the chapters to your GPU server…" : "Getting ready…") : `Saving “${chapter(saving.section)}”`}
            </p>
            <button onClick={() => narrator.stopSaving()} className="rounded-full px-3 py-1.5 text-sm hover:bg-chip">
              Stop
            </button>
          </div>
          {saving.total ? (
            <>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-chip" role="progressbar" aria-valuemin={0} aria-valuemax={saving.total} aria-valuenow={saving.made ?? 0}>
                <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${((saving.made ?? 0) / saving.total) * 100}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-muted tabular-nums">
                Sentence {saving.made ?? 0} of {saving.total}
                {saving.left !== undefined && ` · ${timeLeft(saving.left)}`}
                {more}
                {saving.remote ? " · On your GPU server: you can close this tab." : " · Keep this tab open; the chapter is stored when it's done."}
              </p>
            </>
          ) : (
            saving.remote && more && <p className="mt-1.5 text-[11px] text-muted">{more.slice(3)} · On your GPU server: you can close this tab.</p>
          )}
        </div>
      ) : (
        s.saved < s.savable && (
          <button onClick={() => void narrator.saveBook()} className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-fg">
            Save the whole book
          </button>
        )
      )}
      {s.error && s.status !== "error" && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{s.error}</p>}
      <p className="mt-4 text-[11px] text-muted">
        {fish
          ? `Voice: ${voice?.name ?? "Fish"}, by Fish Audio (S2.1 Pro). Chapters are saved ${server ? "on your GPU server, without its GPU" : "from this tab"}.`
          : `Voice: Kokoro, ${s.engine?.device === "server" ? "on your GPU server" : "made in this browser"}.`}{" "}
        Each book keeps the voice you pick for it.
      </p>
    </div>
  );
}

function Switch({ on, onChange, label, detail }: { on: boolean; onChange: (on: boolean) => void; label: string; detail: string }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className="mt-4 flex w-full items-center gap-3 rounded-2xl text-left">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] text-muted">{detail}</span>
      </span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-chip"}`} aria-hidden>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

function RoundButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-chip aria-pressed:bg-chip sm:size-9"
    >
      {children}
    </button>
  );
}
