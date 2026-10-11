"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { Highlight, HighlightColor, LibraryBook, Progress } from "@/lib/library-types";
import { AiCard, useAiStream } from "./ai-card";
import {
  bookCss,
  DEFAULT_SETTINGS,
  HIGHLIGHT_HEX,
  loadFoliate,
  sanitizeBook,
  THEMES,
  type FoliateView,
  type Location,
  type ReaderSettings,
  type TocItem,
} from "./foliate";
import { Drawer, NotesPanel, SearchPanel, SettingsPanel, TocPanel } from "./panels";

const SETTINGS_KEY = "reader-settings";
const CHROME_HIDE_MS = 2800;
const SAVE_DELAY_MS = 1500;
/** Offer a recap when coming back after this long. */
const RECAP_AFTER_DAYS = 3;

type Panel = "toc" | "notes" | "search" | "settings" | null;

/** A selection (or a clicked highlight) and where to show its popover. */
type Selected = {
  x: number;
  y: number;
  text: string;
  cfi: string;
  sectionIndex: number;
  sectionFraction: number;
  /** Set when the popover is for an existing highlight. */
  noteId?: string;
};

function readSettings(): ReaderSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** How far into its section a range starts (or ends), as a fraction of the section's text. */
function fractionInSection(range: Range, atEnd = false): number {
  const doc = range.startContainer.ownerDocument;
  if (!doc?.body) return 0;
  const before = doc.createRange();
  before.setStart(doc.body, 0);
  if (atEnd) before.setEnd(range.endContainer, range.endOffset);
  else before.setEnd(range.startContainer, range.startOffset);
  const total = doc.body.textContent?.length ?? 0;
  return total ? Math.min(1, before.toString().length / total) : 0;
}

/** Viewport position of a range inside one of foliate's iframes. */
function rangePosition(range: Range): { x: number; y: number } {
  const frame = range.startContainer.ownerDocument?.defaultView?.frameElement;
  const f = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const r = range.getBoundingClientRect();
  return { x: f.left + r.left + r.width / 2, y: f.top + r.top };
}

const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);

export function ReaderView({ id }: { id: string }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<FoliateView | null>(null);
  const highlightDraw = useRef<unknown>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [ticks, setTicks] = useState<number[]>([]);
  const [loc, setLoc] = useState<Location | null>(null);
  const [notes, setNotes] = useState<Highlight[]>([]);
  const notesRef = useRef<Highlight[]>([]);
  const [settings, setSettings] = useState<ReaderSettings>(DEFAULT_SETTINGS);
  const [panel, setPanel] = useState<Panel>(null);
  const [chrome, setChrome] = useState(true);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [offerRecap, setOfferRecap] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const { ai, run: runAi, close: closeAi } = useAiStream();
  /** The passage behind the open "Explain" card, so its answer can be saved as a note. */
  const [explained, setExplained] = useState<Selected | null>(null);
  /** The open view, mirrored from viewRef for rendering (panels that need it). */
  const [view, setView] = useState<FoliateView | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Progress | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- progress -------------------------------------------------------------------------

  const flushProgress = useEffectEvent((keepalive = false) => {
    clearTimeout(saveTimer.current);
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    void fetch(`/api/books/${id}/progress`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    }).catch(() => {});
  });

  const onRelocate = useEffectEvent((detail: Location) => {
    setLoc(detail);
    pending.current = {
      cfi: detail.cfi,
      fraction: detail.fraction,
      sectionIndex: detail.section?.current ?? 0,
      updatedAt: new Date().toISOString(),
    };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushProgress(), SAVE_DELAY_MS);
  });

  // ---- chrome (auto-hiding bars) ---------------------------------------------------------

  const poke = useEffectEvent(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), CHROME_HIDE_MS);
  });

  // ---- notes ----------------------------------------------------------------------------

  const saveNotes = (next: Highlight[]) => {
    notesRef.current = next;
    setNotes(next);
    void fetch(`/api/books/${id}/notes`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: next }),
    }).catch(() => {});
  };

  const addHighlight = (sel: Selected, color: HighlightColor, note?: string) => {
    const view = viewRef.current;
    if (!view) return;
    const highlight: Highlight = {
      id: newId(),
      cfi: sel.cfi,
      text: sel.text.slice(0, 4000),
      color,
      note,
      sectionIndex: sel.sectionIndex,
      createdAt: new Date().toISOString(),
    };
    void view.addAnnotation({ value: highlight.cfi, color: HIGHLIGHT_HEX[color] });
    saveNotes([...notesRef.current, highlight]);
    view.deselect();
    setSelected(null);
    setNoteDraft(null);
  };

  const updateHighlight = (noteId: string, change: Partial<Highlight>) => {
    const view = viewRef.current;
    const next = notesRef.current.map((n) => (n.id === noteId ? { ...n, ...change } : n));
    const updated = next.find((n) => n.id === noteId);
    if (view && updated && change.color) {
      // Re-adding with the same value replaces the drawn highlight.
      void view.addAnnotation({ value: updated.cfi, color: HIGHLIGHT_HEX[updated.color] });
    }
    saveNotes(next);
  };

  const removeHighlight = (noteId: string) => {
    const note = notesRef.current.find((n) => n.id === noteId);
    if (note) void viewRef.current?.deleteAnnotation({ value: note.cfi });
    saveNotes(notesRef.current.filter((n) => n.id !== noteId));
    setSelected(null);
  };

  // ---- AI -------------------------------------------------------------------------------

  const explain = (sel: Selected) => {
    setExplained(sel);
    setSelected(null);
    void runAi(
      "/api/reader/explain",
      { bookId: id, sectionIndex: sel.sectionIndex, sectionFraction: sel.sectionFraction, selection: sel.text },
      { kind: "explain", title: "Explain", quote: sel.text },
    );
  };

  const recap = () => {
    const range = viewRef.current?.lastLocation?.range;
    setOfferRecap(false);
    void runAi(
      "/api/reader/recap",
      {
        bookId: id,
        sectionIndex: loc?.section?.current ?? 0,
        // Up to the end of the visible page: the reader has seen all of it.
        sectionFraction: range ? fractionInSection(range, true) : 0,
      },
      { kind: "recap", title: "Previously…" },
    );
  };

  // ---- input ----------------------------------------------------------------------------

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const view = viewRef.current;
    const target = e.target as HTMLElement | null;
    if (!view || e.metaKey || e.ctrlKey || e.altKey) return;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
      if (e.key === "Escape") (target as HTMLInputElement).blur();
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowLeft: () => void view.goLeft(),
      ArrowRight: () => void view.goRight(),
      PageUp: () => void view.prev(),
      PageDown: () => void view.next(),
      " ": () => void (e.shiftKey ? view.prev() : view.next()),
      t: () => setPanel((p) => (p === "toc" ? null : "toc")),
      n: () => setPanel((p) => (p === "notes" ? null : "notes")),
      "/": () => setPanel("search"),
      a: () => setPanel((p) => (p === "settings" ? null : "settings")),
      f: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      Escape: () => {
        if (selected) setSelected(null);
        else if (ai) closeAi();
        else setPanel(null);
      },
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
      poke();
    }
  });

  const onSelect = useEffectEvent((doc: Document, index: number) => {
    const view = viewRef.current;
    const sel = doc.getSelection();
    if (!view || !sel || sel.isCollapsed || !sel.rangeCount) {
      setSelected((s) => (s?.noteId ? s : null));
      return;
    }
    const range = sel.getRangeAt(0);
    const text = sel.toString().trim();
    if (!text) return;
    setNoteDraft(null);
    setSelected({
      ...rangePosition(range),
      text,
      cfi: view.getCFI(index, range),
      sectionIndex: index,
      sectionFraction: fractionInSection(range, true),
    });
  });

  /** Taps: left quarter goes back, right quarter forward, the middle shows or hides the bars. */
  const onTap = useEffectEvent((e: MouseEvent, doc: Document) => {
    const view = viewRef.current;
    if (!view || !doc.getSelection()?.isCollapsed || (e.target as Element).closest?.("a")) return;
    if (selected || panel) {
      setSelected(null);
      setPanel(null);
      return;
    }
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    const x = (frame?.left ?? 0) + e.clientX;
    const zone = x / window.innerWidth;
    if (settings.flow === "paginated" && zone < 0.22) void view.goLeft();
    else if (settings.flow === "paginated" && zone > 0.78) void view.goRight();
    else {
      clearTimeout(hideTimer.current);
      setChrome((c) => !c);
    }
  });

  const onShowAnnotation = useEffectEvent((value: string, range: Range) => {
    const note = notesRef.current.find((n) => n.cfi === value);
    if (!note) return;
    setNoteDraft(null);
    setSelected({
      ...rangePosition(range),
      text: note.text,
      cfi: note.cfi,
      sectionIndex: note.sectionIndex,
      sectionFraction: fractionInSection(range, true),
      noteId: note.id,
    });
  });

  // ---- open the book ------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let view: FoliateView | null = null;

    (async () => {
      const res = await fetch(`/api/books/${id}`);
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? "Couldn't open this book.");
      }
      const data = (await res.json()) as { book: LibraryBook; fileUrl: string; progress: Progress | null; notes: Highlight[] };
      const file = await fetch(data.fileUrl).then((r) => {
        if (!r.ok) throw new Error("Couldn't download the book file.");
        return r.blob();
      });
      const { create, highlight } = await loadFoliate();
      if (cancelled || !host.current) return;

      const stored = readSettings();
      view = create();
      viewRef.current = view;
      highlightDraw.current = highlight;
      notesRef.current = data.notes;
      host.current.append(view);

      view.addEventListener("relocate", (e) => onRelocate((e as CustomEvent<Location>).detail));
      view.addEventListener("load", (e) => {
        const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
        doc.addEventListener("keydown", (ev) => onKey(ev));
        doc.addEventListener("pointerup", () => setTimeout(() => onSelect(doc, index)));
        doc.addEventListener("keyup", (ev) => ev.shiftKey && onSelect(doc, index));
        doc.addEventListener("click", (ev) => onTap(ev, doc));
        doc.addEventListener("mousemove", () => poke());
      });
      view.addEventListener("create-overlay", (e) => {
        const { index } = (e as CustomEvent<{ index: number }>).detail;
        for (const note of notesRef.current) {
          if (note.sectionIndex === index) void view!.addAnnotation({ value: note.cfi, color: HIGHLIGHT_HEX[note.color] });
        }
      });
      view.addEventListener("draw-annotation", (e) => {
        const { draw, annotation } = (e as CustomEvent<{ draw: (f: unknown, o: unknown) => void; annotation: { color?: string } }>).detail;
        draw(highlightDraw.current, { color: annotation.color ?? HIGHLIGHT_HEX.yellow });
      });
      view.addEventListener("show-annotation", (e) => {
        const { value, range } = (e as CustomEvent<{ value: string; range: Range }>).detail;
        onShowAnnotation(value, range);
      });

      await view.open(new File([file], "book.epub", { type: "application/epub+zip" }));
      sanitizeBook(view.book.transformTarget);
      applySettings(view, stored);
      await view.init({ lastLocation: data.progress?.cfi ?? null, showTextStart: !data.progress });
      if (cancelled) return;

      setSettings(stored);
      setView(view);
      setBook(data.book);
      setNotes(data.notes);
      setToc(view.book.toc ?? []);
      setTicks(view.getSectionFractions());
      setStatus("ready");
      const away = data.progress ? (Date.now() - Date.parse(data.progress.updatedAt)) / 86_400_000 : 0;
      if (data.progress && data.progress.fraction > 0.02 && away >= RECAP_AFTER_DAYS) setOfferRecap(true);
      poke();
    })().catch((err: Error) => {
      if (cancelled) return;
      setError(err.message);
      setStatus("error");
    });

    const onHide = () => flushProgress(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      flushProgress(true);
      clearTimeout(hideTimer.current);
      view?.close();
      view?.remove();
      viewRef.current = null;
    };
  }, [id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => onKey(e);
    const onMove = () => poke();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  // Bars stay visible while a panel, popover or AI card is open.
  const pinned = panel !== null || selected !== null || ai !== null || offerRecap || status !== "ready";
  const showChrome = chrome || pinned;

  const changeSettings = (next: ReaderSettings) => {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (viewRef.current) applySettings(viewRef.current, next);
  };

  const theme = THEMES[settings.theme];
  const sectionIndex = loc?.section?.current ?? 0;
  const chapter = loc?.tocItem?.label?.trim() || book?.sections[sectionIndex]?.title || "";
  const percent = Math.round((scrub ?? loc?.fraction ?? 0) * 100);
  const minutesLeft = loc?.time?.section !== undefined ? Math.max(1, Math.round(loc.time.section)) : null;
  const go = (target: string) => {
    void viewRef.current?.goTo(target);
    setPanel(null);
  };

  return (
    <div
      data-theme={settings.theme === "night" ? "dark" : "light"}
      className="fixed inset-0 overflow-hidden text-fg"
      style={{ background: theme.bg, color: theme.fg }}
    >
      {/* The book. foliate-view is appended here. */}
      <div
        ref={host}
        className={`absolute inset-x-0 transition-[top,bottom] duration-300 [&>foliate-view]:block [&>foliate-view]:size-full ${
          settings.flow === "scrolled" ? "top-16 bottom-16" : "top-14 bottom-14"
        }`}
        style={{ opacity: status === "ready" ? 1 : 0, transition: "opacity .5s ease" }}
      />

      {status === "loading" && <OpeningBook />}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="font-serif text-3xl">This book wouldn&apos;t open.</p>
            <p className="mt-2 text-muted">{error}</p>
            <Link href="/reader" className="pill mt-6">
              Back to your books
            </Link>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header
        className={`reader-surface fixed inset-x-3 top-3 z-40 flex h-12 items-center gap-2 rounded-full px-2 transition-all duration-300 ${
          showChrome ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"
        }`}
        onMouseEnter={() => clearTimeout(hideTimer.current)}
      >
        <Link href="/reader" aria-label="Back to your books" className="grid size-9 place-items-center rounded-full hover:bg-chip">
          <Icon d="M15 6l-6 6 6 6" />
        </Link>
        <BarButton label="Contents (T)" active={panel === "toc"} onClick={() => setPanel(panel === "toc" ? null : "toc")}>
          <Icon d="M4 6h16M4 12h16M4 18h10" />
        </BarButton>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate font-serif text-[15px] leading-tight">{book?.title ?? "Opening…"}</p>
          <p className="truncate text-[11px] text-muted">{book?.author}</p>
        </div>
        <BarButton label="Previously… (recap)" onClick={recap} disabled={status !== "ready"}>
          <Icon d="M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4" />
        </BarButton>
        <BarButton label="Search (/)" active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
          <Icon d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4" />
        </BarButton>
        <BarButton label="Notes (N)" active={panel === "notes"} onClick={() => setPanel(panel === "notes" ? null : "notes")}>
          <Icon d="M6 4h12v16l-6-4-6 4z" />
        </BarButton>
        <BarButton label="Reading settings (A)" active={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")}>
          <span className="font-serif text-[15px] leading-none">Aa</span>
        </BarButton>
      </header>

      {/* Bottom bar: chapter, scrubber with chapter ticks, time left */}
      <footer
        className={`fixed inset-x-3 bottom-3 z-40 transition-all duration-300 ${
          showChrome ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
        onMouseEnter={() => clearTimeout(hideTimer.current)}
      >
        <div className="reader-surface mx-auto flex max-w-3xl items-center gap-3 rounded-full px-4 py-2">
          <button onClick={() => void viewRef.current?.goLeft()} aria-label="Previous page" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-chip">
            <Icon d="M15 6l-6 6 6 6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3 text-[11px] text-muted">
              <span className="truncate">{chapter}</span>
              <span className="shrink-0 tabular-nums">
                {minutesLeft !== null && scrub === null ? `${minutesLeft} min left in chapter · ` : ""}
                {percent}%
              </span>
            </div>
            <div className="relative mt-1.5 h-4">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-chip" />
              <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${percent}%` }} />
              {ticks.slice(1).map((t, i) => (
                <span key={i} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg/20" style={{ left: `${t * 100}%` }} />
              ))}
              <input
                type="range"
                min={0}
                max={1}
                step={0.0005}
                value={scrub ?? loc?.fraction ?? 0}
                aria-label="Position in book"
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrub !== null) void viewRef.current?.goToFraction(scrub);
                  setScrub(null);
                }}
                onKeyUp={() => {
                  if (scrub !== null) void viewRef.current?.goToFraction(scrub);
                  setScrub(null);
                }}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              />
            </div>
          </div>
          <button onClick={() => void viewRef.current?.goRight()} aria-label="Next page" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-chip">
            <Icon d="M9 6l6 6-6 6" />
          </button>
        </div>
      </footer>

      {/* Panels */}
      {panel === "toc" && (
        <Drawer title="Contents" onClose={() => setPanel(null)}>
          <TocPanel toc={toc} current={loc?.tocItem?.href} onGo={go} />
        </Drawer>
      )}
      {panel === "notes" && (
        <Drawer title="Highlights & notes" onClose={() => setPanel(null)}>
          <NotesPanel
            notes={notes}
            sectionTitle={(i) => book?.sections[i]?.title ?? ""}
            onGo={go}
            onDelete={removeHighlight}
          />
        </Drawer>
      )}
      {panel === "search" && view && (
        <Drawer
          title="Search"
          onClose={() => {
            viewRef.current?.clearSearch();
            setPanel(null);
          }}
        >
          <SearchPanel view={view} onGo={(cfi) => void view.goTo(cfi)} />
        </Drawer>
      )}
      {panel === "settings" && <SettingsPanel settings={settings} onChange={changeSettings} />}

      {/* Selection popover */}
      {selected && (
        <SelectionPopover
          selected={selected}
          note={selected.noteId ? notes.find((n) => n.id === selected.noteId) : undefined}
          draft={noteDraft}
          onDraft={setNoteDraft}
          onHighlight={(color) =>
            selected.noteId ? updateHighlight(selected.noteId, { color }) : addHighlight(selected, color)
          }
          onSaveNote={(text) => {
            if (selected.noteId) updateHighlight(selected.noteId, { note: text || undefined });
            else addHighlight(selected, "yellow", text || undefined);
            setNoteDraft(null);
            setSelected(null);
          }}
          onExplain={() => explain(selected)}
          onCopy={() => {
            void navigator.clipboard.writeText(selected.text);
            setSelected(null);
          }}
          onRemove={selected.noteId ? () => removeHighlight(selected.noteId!) : undefined}
        />
      )}

      {offerRecap && !ai && (
        <div className="reader-surface reader-pop fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full py-2 pr-2 pl-5">
          <p className="text-sm">Welcome back. Want a quick recap?</p>
          <button onClick={recap} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-ink-fg">
            Previously…
          </button>
          <button onClick={() => setOfferRecap(false)} aria-label="No thanks" className="grid size-8 place-items-center rounded-full hover:bg-chip">
            ×
          </button>
        </div>
      )}

      {ai && (
        <AiCard
          ai={ai}
          onClose={closeAi}
          onSaveNote={
            ai.kind === "explain" && explained
              ? (text) => {
                  addHighlight(explained, "blue", text);
                  closeAi();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

function applySettings(view: FoliateView, s: ReaderSettings) {
  const r = view.renderer;
  r.setAttribute("flow", s.flow);
  r.setAttribute("max-inline-size", `${s.width}px`);
  r.setAttribute("max-column-count", s.spread ? "2" : "1");
  r.setAttribute("gap", "7%");
  r.setAttribute("margin", "36px");
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) r.removeAttribute("animated");
  else r.setAttribute("animated", "");
  r.setStyles?.(bookCss(s));
}

function SelectionPopover({
  selected,
  note,
  draft,
  onDraft,
  onHighlight,
  onSaveNote,
  onExplain,
  onCopy,
  onRemove,
}: {
  selected: Selected;
  note?: Highlight;
  draft: string | null;
  onDraft: (text: string | null) => void;
  onHighlight: (color: HighlightColor) => void;
  onSaveNote: (text: string) => void;
  onExplain: () => void;
  onCopy: () => void;
  onRemove?: () => void;
}) {
  // Keep the popover on screen; flip below the selection when it's near the top.
  const below = selected.y < 150;
  const x = Math.min(Math.max(selected.x, 170), window.innerWidth - 170);

  return (
    <div
      role="dialog"
      aria-label="Selection"
      className="reader-surface reader-pop fixed z-50 w-max max-w-[min(22rem,calc(100%-1.5rem))] rounded-2xl p-1.5"
      style={{ left: x, top: below ? selected.y + 34 : selected.y - 12, transform: `translate(-50%, ${below ? "0" : "-100%"})` }}
    >
      {draft !== null ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveNote(draft.trim());
          }}
          className="flex w-72 flex-col gap-2 p-1.5"
        >
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            rows={3}
            placeholder="Your note…"
            className="resize-none rounded-xl bg-chip p-3 text-sm outline-none focus:ring-2 focus:ring-accent/40"
          />
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => onDraft(null)} className="rounded-full px-3 py-1.5 text-sm text-muted hover:bg-chip">
              Cancel
            </button>
            <button className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-ink-fg">Save</button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-0.5">
          {(Object.keys(HIGHLIGHT_HEX) as HighlightColor[]).map((color) => (
            <button
              key={color}
              onClick={() => onHighlight(color)}
              aria-label={`Highlight ${color}`}
              aria-pressed={note?.color === color}
              className="grid size-9 place-items-center rounded-full hover:bg-chip"
            >
              <span
                className="size-5 rounded-full ring-1 ring-black/10 [[aria-pressed=true]>&]:ring-2 [[aria-pressed=true]>&]:ring-fg"
                style={{ background: HIGHLIGHT_HEX[color] }}
              />
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-line" />
          <PopButton onClick={() => onDraft(note?.note ?? "")}>{note?.note ? "Edit note" : "Note"}</PopButton>
          <PopButton onClick={onExplain} accent>
            Explain
          </PopButton>
          {onRemove ? <PopButton onClick={onRemove}>Remove</PopButton> : <PopButton onClick={onCopy}>Copy</PopButton>}
        </div>
      )}
    </div>
  );
}

function PopButton({ onClick, accent, children }: { onClick: () => void; accent?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${accent ? "text-accent hover:bg-accent/10" : "hover:bg-chip"}`}
    >
      {accent && <span aria-hidden>✦ </span>}
      {children}
    </button>
  );
}

function BarButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-chip disabled:opacity-40 aria-pressed:bg-chip"
    >
      {children}
    </button>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Shown while the EPUB downloads and lays out: a book whose pages flip. */
function OpeningBook() {
  return (
    <div className="absolute inset-0 grid place-items-center" role="status" aria-label="Opening the book">
      <div className="flex flex-col items-center gap-5">
        <div className="reader-opening relative h-16 w-24 [perspective:400px]">
          <span className="absolute inset-y-0 left-0 w-1/2 rounded-l-md bg-fg/10" />
          <span className="absolute inset-y-0 right-0 w-1/2 rounded-r-md bg-fg/10" />
          <span className="page absolute inset-y-0 right-0 w-1/2 origin-left rounded-r-md bg-fg/20" />
        </div>
        <p className="text-sm text-muted">Opening your book…</p>
      </div>
    </div>
  );
}
