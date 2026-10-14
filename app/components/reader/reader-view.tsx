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
import { ChatPanel, type ChatQuote, type Cite } from "./chat-panel";
import { BACK_HREF, BarButton, CHAT_SPACE, ChatIcon, Icon, OpeningBook, SelectionPopover, useWideScreen, type Selected } from "./chrome";
import { ListenBar } from "./listen-bar";
import { Narrator } from "./narrator";
import { Drawer, NotesPanel, SearchPanel, SettingsPanel, TocPanel } from "./panels";

const SETTINGS_KEY = "reader-settings";
const CHROME_HIDE_MS = 2800;
const SAVE_DELAY_MS = 1500;
/** Offer a recap when coming back after this long. */
const RECAP_AFTER_DAYS = 3;

type Panel = "toc" | "notes" | "search" | "settings" | null;

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
  const [chat, setChat] = useState(false);
  /** A paper's original PDF. */
  const [original, setOriginal] = useState<string | null>(null);
  const [chatQuote, setChatQuote] = useState<ChatQuote | null>(null);
  const wide = useWideScreen();
  /** On a wide screen the open chat sits beside the page, which gives it room. */
  const besideChat = chat && wide ? CHAT_SPACE : undefined;
  /** The passage behind the open "Explain" card, so its answer can be saved as a note. */
  const [explained, setExplained] = useState<Selected | null>(null);
  /** The open view, mirrored from viewRef for rendering (panels that need it). */
  const [view, setView] = useState<FoliateView | null>(null);
  /** Reading aloud: made the first time Listen is pressed. */
  const [narrator, setNarrator] = useState<Narrator | null>(null);
  const [listening, setListening] = useState(false);
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
      { kind: "recap", title: book?.paperId || book?.clipId ? "Where you left off" : "Previously…" },
    );
  };

  // ---- listening ------------------------------------------------------------------------

  const openNarrator = (): Narrator | null => {
    const view = viewRef.current;
    if (!view || !book) return null;
    const n = narrator ?? new Narrator(view, { id, title: book.title, author: book.author, paper: Boolean(book.paperId), sections: book.sections });
    setNarrator(n);
    setListening(true);
    return n;
  };

  const listen = () => {
    if (listening) {
      narrator?.stop();
      setListening(false);
    } else {
      openNarrator()?.start();
    }
  };

  /** Reads aloud from the start of a selection. */
  const listenFrom = (sel: Selected) => {
    const doc = viewRef.current?.renderer.getContents().find((c) => c.index === sel.sectionIndex)?.doc;
    const selection = doc?.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
    const n = openNarrator();
    if (range) n?.startAt(sel.sectionIndex, range);
    else n?.start();
    viewRef.current?.deselect();
    setSelected(null);
  };

  useEffect(() => () => narrator?.destroy(), [narrator]);

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
      c: () => setChat((c) => !c),
      l: () => listen(),
      n: () => setPanel((p) => (p === "notes" ? null : "notes")),
      "/": () => setPanel("search"),
      a: () => setPanel((p) => (p === "settings" ? null : "settings")),
      f: () => void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.()),
      Escape: () => {
        if (selected) setSelected(null);
        else if (ai) closeAi();
        else if (panel) setPanel(null);
        else setChat(false);
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
    // Tap to read, while listening: the tap reads from the sentence tapped instead.
    if (listening && narrator?.tapAt(doc, e.clientX, e.clientY)) return;
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
      const data = (await res.json()) as {
        book: LibraryBook;
        fileUrl: string;
        progress: Progress | null;
        notes: Highlight[];
        original?: string;
      };
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
      setOriginal(data.original ?? null);
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
  const pinned = panel !== null || selected !== null || ai !== null || offerRecap || chat || status !== "ready";

  /** Where the reader is, for the chat (a book's text is shared only up to here). */
  const chatPosition = () => {
    const range = viewRef.current?.lastLocation?.range;
    return { sectionIndex: loc?.section?.current ?? 0, sectionFraction: range ? fractionInSection(range, true) : 0 };
  };

  /** "(§3.2)" in an answer: the contents entry with that number. */
  const followCite = (cite: Cite) => {
    if (!cite.section) return;
    const walk = (items: TocItem[]): TocItem | undefined => {
      for (const item of items) {
        if (item.label.trim().startsWith(`${cite.section} `) || item.label.trim() === cite.section) return item;
        const inner = item.subitems && walk(item.subitems);
        if (inner) return inner;
      }
    };
    const target = walk(toc);
    if (target) void viewRef.current?.goTo(target.href);
  };
  const showChrome = chrome || pinned;

  const changeSettings = (next: ReaderSettings) => {
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    if (viewRef.current) applySettings(viewRef.current, next);
  };

  const theme = THEMES[settings.theme];
  const sectionIndex = loc?.section?.current ?? 0;
  const chapter = loc?.tocItem?.label?.trim() || book?.sections[sectionIndex]?.title || "";
  // foliate can report a NaN fraction for a moment on a fresh book.
  const fraction = Number.isFinite(loc?.fraction) ? loc!.fraction : 0;
  const percent = Math.round((scrub ?? fraction) * 100);
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
        style={{ opacity: status === "ready" ? 1 : 0, transition: "opacity .5s ease", right: besideChat }}
      />

      {status === "loading" && <OpeningBook />}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="font-serif text-3xl">This book wouldn&apos;t open.</p>
            <p className="mt-2 text-muted">{error}</p>
            <Link href="/" className="pill mt-6">
              Back to the shelf
            </Link>
          </div>
        </div>
      )}

      {/* Top bar */}
      <header
        className={`reader-surface fixed inset-x-3 top-3 z-40 flex h-12 items-center gap-0.5 rounded-full px-1.5 transition-all duration-300 sm:gap-2 sm:px-2 ${
          showChrome ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-4 opacity-0"
        }`}
        style={{ right: besideChat }}
        onMouseEnter={() => clearTimeout(hideTimer.current)}
      >
        <Link href={BACK_HREF} aria-label="Back to the library" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-chip sm:size-9">
          <Icon d="M15 6l-6 6 6 6" />
        </Link>
        <BarButton label="Contents (T)" active={panel === "toc"} onClick={() => setPanel(panel === "toc" ? null : "toc")}>
          <Icon d="M4 6h16M4 12h16M4 18h10" />
        </BarButton>
        <div className="min-w-0 flex-1 px-1 text-center">
          <p className="truncate font-serif text-[15px] leading-tight">{book?.title ?? "Opening…"}</p>
          <p className="truncate text-[11px] text-muted">{book?.author}</p>
        </div>
        <BarButton label={book?.paperId || book?.clipId ? "Where you left off (recap)" : "Previously… (recap)"} onClick={recap} disabled={status !== "ready"}>
          <Icon d="M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4" />
        </BarButton>
        <BarButton label="Listen (L)" active={listening} onClick={listen} disabled={status !== "ready"}>
          <Icon d="M4 15v-3a8 8 0 0 1 16 0v3M4 15a2 2 0 0 1 2-2h1v7H6a2 2 0 0 1-2-2zM20 15a2 2 0 0 0-2-2h-1v7h1a2 2 0 0 0 2-2z" />
        </BarButton>
        <BarButton label="Search (/)" active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
          <Icon d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4" />
        </BarButton>
        <BarButton label="Notes (N)" active={panel === "notes"} onClick={() => setPanel(panel === "notes" ? null : "notes")}>
          <Icon d="M6 4h12v16l-6-4-6 4z" />
        </BarButton>
        {original && (
          <a
            href={original}
            target="_blank"
            rel="noreferrer"
            title="The original PDF"
            className="hidden h-8 shrink-0 items-center rounded-full px-2.5 text-xs font-semibold tracking-wide hover:bg-chip sm:inline-flex"
          >
            PDF ↗
          </a>
        )}
        <BarButton label="Chat (C)" active={chat} onClick={() => setChat((c) => !c)}>
          <ChatIcon />
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
        style={{ right: besideChat }}
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
              {ticks.slice(1).filter(Number.isFinite).map((t, i) => (
                <span key={i} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg/20" style={{ left: `${t * 100}%` }} />
              ))}
              <input
                type="range"
                min={0}
                max={1}
                step={0.0005}
                value={scrub ?? fraction}
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
          onListen={selected.noteId ? undefined : () => listenFrom(selected)}
          onAsk={() => {
            setChatQuote({ text: selected.text });
            setChat(true);
            viewRef.current?.deselect();
            setSelected(null);
          }}
          onCopy={() => {
            void navigator.clipboard.writeText(selected.text);
            setSelected(null);
          }}
          onRemove={selected.noteId ? () => removeHighlight(selected.noteId!) : undefined}
        />
      )}

      {offerRecap && !ai && (
        <div className="reader-surface reader-pop fixed bottom-24 left-1/2 z-50 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-[28px] py-2 pr-2 pl-5">
          <p className="min-w-0 text-sm leading-snug">Welcome back. Want a quick recap?</p>
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
          right={besideChat}
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

      {listening && narrator && (
        <ListenBar
          narrator={narrator}
          // The contents entry for the page shown (which follows the reading), else the file's title.
          chapter={(i) => (i === sectionIndex && loc?.tocItem?.label?.trim()) || book?.sections[i]?.title || `Chapter ${i + 1}`}
          raised={showChrome}
          right={besideChat}
          onClose={() => setListening(false)}
        />
      )}

      {chat && (
        <ChatPanel
          key={id}
          bookId={id}
          paper={Boolean(book?.paperId)}
          onClose={() => setChat(false)}
          getPosition={chatPosition}
          quote={chatQuote}
          onQuoteUsed={() => setChatQuote(null)}
          onCite={followCite}
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
