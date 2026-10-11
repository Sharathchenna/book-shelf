"use client";

import { useRef, useState } from "react";
import type { Highlight } from "@/lib/library-types";
import {
  FONTS,
  HIGHLIGHT_HEX,
  THEMES,
  type FoliateView,
  type FontName,
  type ReaderSettings,
  type ThemeName,
  type TocItem,
} from "./foliate";

/** A side drawer shared by the contents, notes and search panels. */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside
      role="dialog"
      aria-label={title}
      className="reader-surface reader-drawer fixed top-3 bottom-3 left-3 z-50 flex w-[min(24rem,calc(100%-1.5rem))] flex-col rounded-3xl"
    >
      <header className="flex items-center justify-between px-5 pt-5 pb-3">
        <h2 className="font-serif text-2xl">{title}</h2>
        <button onClick={onClose} aria-label="Close" className="grid size-9 place-items-center rounded-full bg-chip hover:bg-line">
          ×
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">{children}</div>
    </aside>
  );
}

export function TocPanel({ toc, current, onGo }: { toc: TocItem[]; current?: string; onGo: (href: string) => void }) {
  const render = (items: TocItem[], depth: number) =>
    items.map((item, i) => (
      <li key={`${item.href}-${i}`}>
        <button
          onClick={() => onGo(item.href)}
          aria-current={item.href === current ? "location" : undefined}
          className="w-full rounded-xl px-3 py-2 text-left text-[15px] transition-colors hover:bg-chip aria-[current=location]:bg-accent/12 aria-[current=location]:font-semibold aria-[current=location]:text-accent"
          style={{ paddingLeft: `${0.75 + depth * 1}rem` }}
        >
          {item.label.trim()}
        </button>
        {item.subitems?.length ? <ul>{render(item.subitems, depth + 1)}</ul> : null}
      </li>
    ));
  return toc.length ? <ul>{render(toc, 0)}</ul> : <p className="px-3 text-sm text-muted">This book has no table of contents.</p>;
}

export function NotesPanel({
  notes,
  sectionTitle,
  onGo,
  onDelete,
}: {
  notes: Highlight[];
  sectionTitle: (index: number) => string;
  onGo: (cfi: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!notes.length) {
    return (
      <p className="px-3 text-sm leading-relaxed text-muted">
        Select text while reading to highlight it, add a note, or ask for an explanation.
      </p>
    );
  }
  const sorted = notes.toSorted((a, b) => a.sectionIndex - b.sectionIndex || a.createdAt.localeCompare(b.createdAt));
  return (
    <ul className="space-y-2">
      {sorted.map((n) => (
        <li key={n.id} className="group rounded-2xl p-3 transition-colors hover:bg-chip">
          <p className="text-[11px] tracking-[0.12em] text-muted uppercase">{sectionTitle(n.sectionIndex)}</p>
          <button onClick={() => onGo(n.cfi)} className="mt-1.5 block w-full text-left">
            <span className="font-serif text-[15px] leading-snug" style={{ boxShadow: `inset 0 -0.55em 0 ${HIGHLIGHT_HEX[n.color]}88` }}>
              {n.text}
            </span>
          </button>
          {n.note && <p className="mt-2 border-l-2 border-line pl-3 text-sm text-muted">{n.note}</p>}
          <button onClick={() => onDelete(n.id)} className="mt-2 text-xs text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus:opacity-100">
            Remove
          </button>
        </li>
      ))}
    </ul>
  );
}

type SearchResult = { label: string; items: { cfi: string; pre: string; match: string; post: string }[] };

export function SearchPanel({ view, onGo }: { view: FoliateView; onGo: (cfi: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const run = useRef(0);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    const id = ++run.current;
    view.clearSearch();
    setResults([]);
    if (q.length < 2) return;
    setProgress(0);
    const found: SearchResult[] = [];
    for await (const result of view.search({ query: q })) {
      if (id !== run.current) return;
      if (result === "done") break;
      if (result.progress !== undefined) setProgress(result.progress);
      if (result.subitems) {
        found.push({
          label: result.label || "Untitled section",
          items: result.subitems.map((s) => ({ cfi: s.cfi, ...s.excerpt })),
        });
        setResults([...found]);
      }
    }
    setProgress(null);
  };

  const total = results.reduce((n, r) => n + r.items.length, 0);

  return (
    <div>
      <form onSubmit={search} className="sticky top-0 z-10 bg-bg px-1 pt-1 pb-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this book"
          aria-label="Search this book"
          className="w-full rounded-full bg-chip px-4 py-2.5 outline-none focus:ring-2 focus:ring-accent/40"
        />
        <p className="mt-2 px-2 text-xs text-muted" aria-live="polite">
          {progress !== null ? `Searching… ${Math.round(progress * 100)}%` : query && results.length ? `${total} matches` : ""}
        </p>
      </form>
      {results.map((r, i) => (
        <section key={i} className="mb-3">
          <h3 className="px-3 py-1 text-[11px] tracking-[0.12em] text-muted uppercase">{r.label}</h3>
          <ul>
            {r.items.map((item) => (
              <li key={item.cfi}>
                <button onClick={() => onGo(item.cfi)} className="w-full rounded-xl px-3 py-2 text-left text-sm leading-snug hover:bg-chip">
                  …{item.pre}
                  <mark className="rounded bg-accent/25 px-0.5 text-inherit">{item.match}</mark>
                  {item.post}…
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The "Aa" popover: theme, font, size, spacing, width, layout. */
export function SettingsPanel({ settings, onChange }: { settings: ReaderSettings; onChange: (s: ReaderSettings) => void }) {
  const set = <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <div className="reader-surface reader-pop fixed top-16 right-3 z-50 w-[min(20rem,calc(100%-1.5rem))] space-y-5 rounded-3xl p-5" role="dialog" aria-label="Reading settings">
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(THEMES) as ThemeName[]).map((name) => (
          <button
            key={name}
            onClick={() => set("theme", name)}
            aria-pressed={settings.theme === name}
            className="flex flex-col items-center gap-1.5 text-xs text-muted aria-pressed:text-fg"
          >
            <span
              className="grid size-11 place-items-center rounded-full font-serif text-base ring-1 ring-black/10 transition-shadow [[aria-pressed=true]>&]:ring-2 [[aria-pressed=true]>&]:ring-accent"
              style={{ background: THEMES[name].bg, color: THEMES[name].fg }}
            >
              Aa
            </span>
            {THEMES[name].label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-1.5 rounded-2xl bg-chip p-1">
        {(Object.keys(FONTS) as FontName[]).map((name) => (
          <button
            key={name}
            onClick={() => set("font", name)}
            aria-pressed={settings.font === name}
            className="rounded-xl py-2 text-sm transition-colors aria-pressed:bg-bg aria-pressed:shadow-sm"
            style={{ fontFamily: FONTS[name].stack || undefined }}
          >
            {FONTS[name].label}
          </button>
        ))}
      </div>

      <Slider label="Text size" value={settings.size} min={80} max={160} step={5} format={(v) => `${v}%`} onChange={(v) => set("size", v)} />
      <Slider label="Line spacing" value={settings.lineHeight} min={1.2} max={2.2} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set("lineHeight", v)} />
      {/* A phone's screen is narrower than any column width, and never fits two pages. */}
      <div className="hidden sm:block">
        <Slider label="Column width" value={settings.width} min={480} max={960} step={20} format={(v) => `${v}px`} onChange={(v) => set("width", v)} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Toggle on={settings.flow === "scrolled"} onClick={() => set("flow", settings.flow === "scrolled" ? "paginated" : "scrolled")}>
          Scroll
        </Toggle>
        <Toggle on={settings.spread} onClick={() => set("spread", !settings.spread)} className="hidden sm:inline-flex">
          Two pages
        </Toggle>
        <Toggle on={settings.justify} onClick={() => set("justify", !settings.justify)}>
          Justify
        </Toggle>
      </div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-muted">
        {label}
        <span className="tabular-nums">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-(--accent)"
      />
    </label>
  );
}

function Toggle({ on, onClick, className = "", children }: { on: boolean; onClick: () => void; className?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`rounded-full border border-line px-3 py-1.5 text-sm transition-colors aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-fg ${className}`}
    >
      {children}
    </button>
  );
}
