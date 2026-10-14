"use client";

import Link from "next/link";
import { memo, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { Highlight, HighlightColor, LibraryBook, Progress } from "@/lib/library-types";
import { READER_ACTIONS, type ReaderAction } from "@/lib/reader-actions";
import { AiCard, useAiStream } from "./ai-card";
import { ChatPanel, type ChatQuote, type Cite } from "./chat-panel";
import { BACK_HREF, BarButton, CHAT_SPACE, ChatIcon, Icon, OpeningBook, SelectionPopover, useWideScreen, type Selected } from "./chrome";
import { HIGHLIGHT_HEX, THEMES, type ThemeName, type TocItem } from "./foliate";
import { Drawer, NotesPanel, TocPanel } from "./panels";
import { flatOutline, loadPdfjs, openPdf, outline, pageText, sectionAt, toBase64Jpeg, type PDFDocumentProxy } from "./pdf";
import "./pdf.css";

const SETTINGS_KEY = "pdf-reader-settings";
const CHROME_HIDE_MS = 2800;
const SAVE_DELAY_MS = 1500;
const RECAP_AFTER_DAYS = 3;
/** "Fit width" stops here on wide screens: wider pages are hard to read line by line. */
const MAX_FIT_WIDTH = 900;
/** Where in the viewport counts as "the page you're on". */
const READING_LINE = 0.35;
const ZOOMS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

type PdfSettings = { theme: ThemeName; zoom: number };
const DEFAULT_SETTINGS: PdfSettings = { theme: "paper", zoom: 1 };

/** Themes recolour the rendered page with a CSS filter; hue-rotate keeps figures' colours roughly right in Night. */
const PAGE_LOOK: Record<ThemeName, { filter: string; blank: string; ink: "multiply" | "screen" }> = {
  paper: { filter: "none", blank: "#ffffff", ink: "multiply" },
  sepia: { filter: "sepia(0.32) saturate(0.9) brightness(0.97)", blank: "#f3e9d6", ink: "multiply" },
  sage: { filter: "sepia(0.18) hue-rotate(65deg) saturate(0.55) brightness(0.98)", blank: "#eef2ec", ink: "multiply" },
  night: { filter: "invert(0.88) hue-rotate(180deg)", blank: "#1f1f1f", ink: "screen" },
};

type Panel = "toc" | "notes" | "search" | "settings" | null;
type Rect = [number, number, number, number];
type PdfSelected = Selected & { page: number; rects: Rect[] };
type Size = { w: number; h: number };

function readSettings(): PdfSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const NO_HIGHLIGHTS: Highlight[] = [];
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const pageOf = (cfi: string) => Number(cfi.match(/^page:(\d+)/)?.[1] ?? 1);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Selection rectangles as fractions of the page, one per line where pdf.js split a line into runs. */
function selectionRects(range: Range, pageBox: DOMRect): Rect[] {
  const rects = [...range.getClientRects()]
    .map((r) => {
      const left = Math.max(r.left, pageBox.left);
      const right = Math.min(r.right, pageBox.right);
      const top = Math.max(r.top, pageBox.top);
      const bottom = Math.min(r.bottom, pageBox.bottom);
      return { left, top, right, bottom };
    })
    .filter((r) => r.right - r.left > 1 && r.bottom - r.top > 1)
    .sort((a, b) => a.top - b.top || a.left - b.left);

  const merged: typeof rects = [];
  for (const r of rects) {
    const last = merged.at(-1);
    const sameLine = last && Math.min(last.bottom, r.bottom) - Math.max(last.top, r.top) > 0.5 * Math.min(last.bottom - last.top, r.bottom - r.top);
    if (last && sameLine && r.left - last.right < 12) {
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else merged.push({ ...r });
  }
  return merged.slice(0, 300).map((r) => [
    (r.left - pageBox.left) / pageBox.width,
    (r.top - pageBox.top) / pageBox.height,
    (r.right - r.left) / pageBox.width,
    (r.bottom - r.top) / pageBox.height,
  ]);
}

/** The selected region cut from the rendered page, so Explain can read equations the text layer garbles. */
function cropSelection(page: number, rects: Rect[]): string | undefined {
  const canvas = document.querySelector<HTMLCanvasElement>(`[data-page="${page}"] canvas`);
  if (!canvas?.width || !rects.length) return undefined;
  const pad = 0.015;
  const left = Math.max(0, Math.min(...rects.map((r) => r[0])) - pad);
  const top = Math.max(0, Math.min(...rects.map((r) => r[1])) - pad);
  const right = Math.min(1, Math.max(...rects.map((r) => r[0] + r[2])) + pad);
  const bottom = Math.min(1, Math.max(...rects.map((r) => r[1] + r[3])) + pad);
  const sx = left * canvas.width;
  const sy = top * canvas.height;
  const sw = (right - left) * canvas.width;
  const sh = (bottom - top) * canvas.height;
  const scale = Math.min(1, 1400 / sw, 1400 / sh);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  out.getContext("2d")!.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return toBase64Jpeg(out);
}

export function PdfReaderView({ id }: { id: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [book, setBook] = useState<LibraryBook | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [notes, setNotes] = useState<Highlight[]>([]);
  const notesRef = useRef<Highlight[]>([]);
  const [settings, setSettings] = useState<PdfSettings>(DEFAULT_SETTINGS);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [fraction, setFraction] = useState(0);
  const [panel, setPanel] = useState<Panel>(null);
  const [chrome, setChrome] = useState(true);
  const [selected, setSelected] = useState<PdfSelected | null>(null);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [offerRecap, setOfferRecap] = useState(false);
  const [scrub, setScrub] = useState<number | null>(null);
  const { ai, run: runAi, close: closeAi } = useAiStream();
  const [explained, setExplained] = useState<PdfSelected | null>(null);
  const [chat, setChat] = useState(false);
  const [chatQuote, setChatQuote] = useState<ChatQuote | null>(null);
  const wide = useWideScreen();
  /** On a wide screen the open chat sits beside the pages, which gives it room. */
  const besideChat = chat && wide ? CHAT_SPACE : undefined;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<Progress | null>(null);
  /** Where to scroll once pages are laid out: on open, and to hold the place across zooms. */
  const anchor = useRef<number | null>(null);
  const lastScroll = useRef(0);
  const fractionRef = useRef(0);
  const texts = useRef(new Map<number, string>());

  const flat = useMemo(() => flatOutline(toc), [toc]);
  const highlightsByPage = useMemo(() => Map.groupBy(notes, (note) => pageOf(note.cfi)), [notes]);
  const numPages = sizes.length;
  const fitWidth = Math.max(240, Math.min(width - 24, MAX_FIT_WIDTH));
  const scale = sizes[0] ? (fitWidth * settings.zoom) / sizes[0].w : 1;
  const look = PAGE_LOOK[settings.theme];
  const theme = THEMES[settings.theme];

  const pinned = panel !== null || selected !== null || ai !== null || offerRecap || chat || status !== "ready";
  // Bars stay visible while a panel, popover or AI card is open.
  const showChrome = chrome || pinned;

  const changeSettings = (next: PdfSettings) => {
    if (next.zoom !== settings.zoom) anchor.current = fractionRef.current;
    setSettings(next);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  };

  const getText = async (n: number) => {
    if (!texts.current.has(n) && doc) texts.current.set(n, await pageText(await doc.getPage(n)));
    return texts.current.get(n) ?? "";
  };

  // ---- chrome ----------------------------------------------------------------------------

  const poke = useEffectEvent(() => {
    setChrome(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setChrome(false), CHROME_HIDE_MS);
  });

  // ---- position --------------------------------------------------------------------------

  const pageEls = () => [...(scroller.current?.querySelectorAll<HTMLElement>("[data-page]") ?? [])];

  const scrollToFraction = (f: number, smooth = false) => {
    const el = scroller.current;
    const els = pageEls();
    if (!el || !els.length) return;
    const exact = Math.min(Math.max(f, 0), 0.99999) * els.length;
    const target = els[Math.floor(exact)];
    const top = target.offsetTop + (exact % 1) * target.offsetHeight - el.clientHeight * READING_LINE;
    el.scrollTo({ top: Math.max(0, top), behavior: smooth && !reducedMotion() ? "smooth" : "instant" });
  };

  const goToPage = (n: number) => {
    const target = pageEls()[Math.min(Math.max(n, 1), numPages) - 1];
    if (!target || !scroller.current) return;
    scroller.current.scrollTo({ top: target.offsetTop - 72, behavior: reducedMotion() ? "instant" : "smooth" });
  };

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

  const onScroll = useEffectEvent(() => {
    const el = scroller.current;
    if (!el || status !== "ready") return;
    // Scrolling down hides the bars; scrolling up brings them back.
    const delta = el.scrollTop - lastScroll.current;
    lastScroll.current = el.scrollTop;
    if (delta > 6 && !pinned) setChrome(false);
    else if (delta < -6) poke();

    const line = el.scrollTop + el.clientHeight * READING_LINE;
    const els = pageEls();
    let i = els.findLastIndex((p) => p.offsetTop <= line);
    if (i < 0) i = 0;
    const within = Math.min(1, Math.max(0, (line - els[i].offsetTop) / els[i].offsetHeight));
    const f = (i + within) / els.length;
    setPage(i + 1);
    setFraction(f);
    fractionRef.current = f;
    pending.current = { cfi: `page:${i + 1}`, fraction: f, sectionIndex: i, updatedAt: new Date().toISOString() };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushProgress(), SAVE_DELAY_MS);
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

  const addHighlight = (sel: PdfSelected, color: HighlightColor, note?: string) => {
    saveNotes([
      ...notesRef.current,
      {
        id: newId(),
        cfi: `page:${sel.page}`,
        rects: sel.rects,
        text: sel.text.slice(0, 4000),
        color,
        note,
        sectionIndex: sel.page - 1,
        createdAt: new Date().toISOString(),
      },
    ]);
    window.getSelection()?.removeAllRanges();
    setSelected(null);
    setNoteDraft(null);
  };

  const updateHighlight = (noteId: string, change: Partial<Highlight>) =>
    saveNotes(notesRef.current.map((n) => (n.id === noteId ? { ...n, ...change } : n)));

  const removeHighlight = (noteId: string) => {
    saveNotes(notesRef.current.filter((n) => n.id !== noteId));
    setSelected(null);
  };

  // ---- AI -------------------------------------------------------------------------------

  const explain = (sel: PdfSelected, action: ReaderAction = "explain") => {
    setExplained(sel);
    setSelected(null);
    void runAi(
      "/api/reader/explain",
      {
        bookId: id,
        sectionIndex: sel.sectionIndex,
        sectionFraction: sel.sectionFraction,
        selection: sel.text,
        image: cropSelection(sel.page, sel.rects),
        action,
      },
      { kind: "explain", title: READER_ACTIONS[action].label, quote: sel.text },
    );
  };

  const recap = () => {
    const el = scroller.current;
    const current = pageEls()[page - 1];
    // Up to the bottom of the screen: the reader has seen all of it.
    const seen = el && current ? (el.scrollTop + el.clientHeight - current.offsetTop) / current.offsetHeight : 1;
    setOfferRecap(false);
    void runAi(
      "/api/reader/recap",
      { bookId: id, sectionIndex: page - 1, sectionFraction: Math.min(1, Math.max(0, seen)) },
      { kind: "recap", title: book?.paperId ? "Where you left off" : "Previously…" },
    );
  };

  // ---- input ----------------------------------------------------------------------------

  const zoomBy = (step: number) => {
    const at = ZOOMS.findIndex((z) => z >= settings.zoom - 0.001);
    const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (at < 0 ? 4 : at) + step))];
    changeSettings({ ...settings, zoom: next });
  };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (status !== "ready" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) {
      if (e.key === "Escape") (target as HTMLInputElement).blur();
      return;
    }
    const keys: Record<string, () => void> = {
      ArrowLeft: () => goToPage(page - 1),
      ArrowRight: () => goToPage(page + 1),
      t: () => setPanel((p) => (p === "toc" ? null : "toc")),
      c: () => setChat((c) => !c),
      n: () => setPanel((p) => (p === "notes" ? null : "notes")),
      "/": () => setPanel("search"),
      a: () => setPanel((p) => (p === "settings" ? null : "settings")),
      "+": () => zoomBy(1),
      "=": () => zoomBy(1),
      "-": () => zoomBy(-1),
      "0": () => changeSettings({ ...settings, zoom: 1 }),
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
    }
  });

  /** A finished selection opens the popover; a plain click on a highlight opens it for that note. */
  const onPointerUp = useEffectEvent((e: PointerEvent) => {
    if ((e.target as Element).closest?.("[data-reader-ui]")) return;
    const sel = window.getSelection();
    const pageEl = (e.target as Element).closest?.<HTMLElement>("[data-page]");

    if (sel && !sel.isCollapsed && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const startPage = (range.startContainer.parentElement ?? (range.startContainer as Element)).closest?.<HTMLElement>("[data-page]");
      const text = sel.toString().replace(/\s+/g, " ").trim();
      if (!startPage || !text) return;
      const n = Number(startPage.dataset.page);
      const box = startPage.getBoundingClientRect();
      const layer = startPage.querySelector(".textLayer");
      let sectionFraction = 1;
      if (layer?.textContent) {
        const before = document.createRange();
        before.setStart(layer, 0);
        before.setEnd(range.endContainer, range.endOffset);
        sectionFraction = Math.min(1, before.toString().length / layer.textContent.length);
      }
      const r = range.getBoundingClientRect();
      setNoteDraft(null);
      setSelected({
        x: r.left + r.width / 2,
        y: r.top,
        text,
        cfi: `page:${n}`,
        page: n,
        rects: selectionRects(range, box),
        sectionIndex: n - 1,
        sectionFraction,
      });
      return;
    }

    if (selected || panel) {
      setSelected(null);
      setPanel(null);
      return;
    }
    if (!pageEl) return;
    const n = Number(pageEl.dataset.page);
    const box = pageEl.getBoundingClientRect();
    const [x, y] = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
    const hit = notesRef.current.find(
      (note) => pageOf(note.cfi) === n && note.rects?.some(([l, t, w, h]) => x >= l && x <= l + w && y >= t && y <= t + h),
    );
    if (hit) {
      setNoteDraft(null);
      setSelected({
        x: e.clientX,
        y: e.clientY - 8,
        text: hit.text,
        cfi: hit.cfi,
        page: n,
        rects: hit.rects ?? [],
        sectionIndex: hit.sectionIndex,
        sectionFraction: 1,
        noteId: hit.id,
      });
    } else {
      clearTimeout(hideTimer.current);
      setChrome((c) => !c);
    }
  });

  // ---- open the document ------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    let opened: PDFDocumentProxy | null = null;

    (async () => {
      const res = await fetch(`/api/books/${id}`);
      if (!res.ok) {
        const { error } = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(error ?? "Couldn't open this PDF.");
      }
      const data = (await res.json()) as { book: LibraryBook; fileUrl: string; progress: Progress | null; notes: Highlight[] };
      const file = await fetch(data.fileUrl).then((r) => {
        if (!r.ok) throw new Error("Couldn't download the PDF.");
        return r.arrayBuffer();
      });
      opened = await openPdf(file);
      const pdf = opened;
      // Every page's size up front, so the scroll height is right before pages render.
      const all: Size[] = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
        all.push({ w: viewport.width, h: viewport.height });
      }
      const contents = await outline(pdf);
      if (cancelled) return;

      setSettings(readSettings());
      setBook(data.book);
      setNotes(data.notes);
      notesRef.current = data.notes;
      setToc(contents);
      setSizes(all);
      setDoc(pdf);
      anchor.current = data.progress?.fraction ?? 0;
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
      void opened?.loadingTask.destroy();
    };
  }, [id]);

  // Track the column width, for "fit width". Pages rescale with it, so hold the reader's place.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      anchor.current ??= fractionRef.current;
      setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // After a layout change (opening, zooming), put the reader back where they were.
  const restore = useEffectEvent(() => {
    if (status !== "ready" || !width || anchor.current === null) return;
    const f = anchor.current;
    anchor.current = null;
    requestAnimationFrame(() => scrollToFraction(f));
  });
  useEffect(() => restore(), [status, width, scale]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => onKey(e);
    const onMove = () => poke();
    const onUp = (e: PointerEvent) => setTimeout(() => onPointerUp(e));
    let frame = 0;
    const onScrolled = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => onScroll());
    };
    const el = scroller.current;
    el?.addEventListener("scroll", onScrolled, { passive: true });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("pointerup", onUp);
      el?.removeEventListener("scroll", onScrolled);
      cancelAnimationFrame(frame);
    };
  }, []);

  const section = sectionAt(flat, page);
  const shownPage = scrub ?? page;
  const percent = Math.round((scrub ? (scrub - 1) / Math.max(1, numPages - 1) : fraction) * 100);
  const topLevelTicks = [...new Set(toc.map((item) => Number(item.href.slice(5))))].filter((n) => n > 1);

  return (
    <div
      data-theme={settings.theme === "night" ? "dark" : "light"}
      className="fixed inset-0 overflow-hidden text-fg"
      style={{ background: theme.bg, color: theme.fg }}
    >
      <div ref={scroller} className="absolute inset-0 overflow-auto overscroll-contain" style={{ right: besideChat }}>
        <div
          className="flex flex-col items-center gap-4 px-3 pt-[72px] pb-24"
          style={{ opacity: status === "ready" ? 1 : 0, transition: "opacity .5s ease", minWidth: "fit-content" }}
        >
          {doc &&
            width > 0 &&
            sizes.map((size, i) => (
              <PdfPage
                key={i}
                doc={doc}
                n={i + 1}
                width={size.w * scale}
                height={size.h * scale}
                scale={scale}
                filter={look.filter}
                blank={look.blank}
                blend={look.ink}
                highlights={highlightsByPage.get(i + 1) ?? NO_HIGHLIGHTS}
                root={scroller}
              />
            ))}
        </div>
      </div>

      {status === "loading" && <OpeningBook label="Opening your PDF…" />}
      {status === "error" && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="font-serif text-3xl">This PDF wouldn&apos;t open.</p>
            <p className="mt-2 text-muted">{error}</p>
            <Link href="/" className="pill mt-6">
              Back to the shelf
            </Link>
          </div>
        </div>
      )}

      <header
        data-reader-ui
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
        <BarButton label={book?.paperId ? "Where you left off (recap)" : "Previously… (recap)"} onClick={recap} disabled={status !== "ready"}>
          <Icon d="M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4" />
        </BarButton>
        <BarButton label="Search (/)" active={panel === "search"} onClick={() => setPanel(panel === "search" ? null : "search")}>
          <Icon d="M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4 4" />
        </BarButton>
        <BarButton label="Notes (N)" active={panel === "notes"} onClick={() => setPanel(panel === "notes" ? null : "notes")}>
          <Icon d="M6 4h12v16l-6-4-6 4z" />
        </BarButton>
        <BarButton label="Chat (C)" active={chat} onClick={() => setChat((c) => !c)}>
          <ChatIcon />
        </BarButton>
        <BarButton label="View: theme and zoom (A)" active={panel === "settings"} onClick={() => setPanel(panel === "settings" ? null : "settings")}>
          <span className="font-serif text-[15px] leading-none">Aa</span>
        </BarButton>
      </header>

      <footer
        data-reader-ui
        className={`fixed inset-x-3 bottom-3 z-40 transition-all duration-300 ${
          showChrome ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"
        }`}
        style={{ right: besideChat }}
        onMouseEnter={() => clearTimeout(hideTimer.current)}
      >
        <div className="reader-surface mx-auto flex max-w-3xl items-center gap-3 rounded-full px-4 py-2">
          <button onClick={() => goToPage(page - 1)} aria-label="Previous page" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-chip">
            <Icon d="M15 6l-6 6 6 6" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex justify-between gap-3 text-[11px] text-muted">
              <span className="truncate">{scrub ? (sectionAt(flat, scrub)?.label ?? "") : (section?.label ?? "")}</span>
              <span className="shrink-0 tabular-nums">
                Page {shownPage} of {numPages || "…"} · {percent}%
              </span>
            </div>
            <div className="relative mt-1.5 h-4">
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-chip" />
              <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-accent" style={{ width: `${percent}%` }} />
              {topLevelTicks.map((n) => (
                <span key={n} className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-fg/20" style={{ left: `${((n - 1) / numPages) * 100}%` }} />
              ))}
              <input
                type="range"
                min={1}
                max={Math.max(1, numPages)}
                step={1}
                value={shownPage}
                aria-label="Page"
                onChange={(e) => setScrub(Number(e.target.value))}
                onPointerUp={() => {
                  if (scrub !== null) goToPage(scrub);
                  setScrub(null);
                }}
                onKeyUp={() => {
                  if (scrub !== null) goToPage(scrub);
                  setScrub(null);
                }}
                className="absolute inset-0 w-full cursor-pointer opacity-0"
              />
            </div>
          </div>
          <button onClick={() => goToPage(page + 1)} aria-label="Next page" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-chip">
            <Icon d="M9 6l6 6-6 6" />
          </button>
        </div>
      </footer>

      {panel === "toc" && (
        <div data-reader-ui>
          <Drawer title="Contents" onClose={() => setPanel(null)}>
            {toc.length ? (
              <TocPanel
                toc={toc}
                current={section?.href}
                onGo={(href) => {
                  goToPage(pageOf(href));
                  setPanel(null);
                }}
              />
            ) : (
              <p className="px-3 text-sm text-muted">This PDF has no bookmarks. Use the page slider or search instead.</p>
            )}
          </Drawer>
        </div>
      )}
      {panel === "notes" && (
        <div data-reader-ui>
          <Drawer title="Highlights & notes" onClose={() => setPanel(null)}>
            <NotesPanel
              notes={notes}
              sectionTitle={(i) => book?.sections[i]?.title ?? `Page ${i + 1}`}
              onGo={(cfi) => {
                goToPage(pageOf(cfi));
                setPanel(null);
              }}
              onDelete={removeHighlight}
            />
          </Drawer>
        </div>
      )}
      {panel === "search" && (
        <div data-reader-ui>
          <Drawer title="Search" onClose={() => setPanel(null)}>
            <PdfSearch numPages={numPages} getText={getText} label={(n) => sectionAt(flat, n)?.label} onGo={goToPage} />
          </Drawer>
        </div>
      )}
      {panel === "settings" && (
        <div data-reader-ui>
          <PdfSettingsPanel settings={settings} onChange={changeSettings} onZoom={zoomBy} />
        </div>
      )}

      {selected && (
        <div data-reader-ui>
          <SelectionPopover
            selected={selected}
            note={selected.noteId ? notes.find((n) => n.id === selected.noteId) : undefined}
            draft={noteDraft}
            onDraft={setNoteDraft}
            onHighlight={(color) => (selected.noteId ? updateHighlight(selected.noteId, { color }) : addHighlight(selected, color))}
            onSaveNote={(text) => {
              if (selected.noteId) updateHighlight(selected.noteId, { note: text || undefined });
              else addHighlight(selected, "yellow", text || undefined);
              setNoteDraft(null);
              setSelected(null);
            }}
            onExplain={(action) => explain(selected, action)}
            onAsk={() => {
              setChatQuote({ text: selected.text, image: cropSelection(selected.page, selected.rects) });
              setChat(true);
              window.getSelection()?.removeAllRanges();
              setSelected(null);
            }}
            onCopy={() => {
              void navigator.clipboard.writeText(selected.text);
              setSelected(null);
            }}
            onRemove={selected.noteId ? () => removeHighlight(selected.noteId!) : undefined}
          />
        </div>
      )}

      {offerRecap && !ai && (
        <div data-reader-ui className="reader-surface reader-pop fixed bottom-24 left-1/2 z-50 flex w-max max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-3 rounded-[28px] py-2 pr-2 pl-5">
          <p className="min-w-0 text-sm leading-snug">Welcome back. Want a quick recap?</p>
          <button onClick={recap} className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium whitespace-nowrap text-ink-fg">
            {book?.paperId ? "Where was I?" : "Previously…"}
          </button>
          <button onClick={() => setOfferRecap(false)} aria-label="No thanks" className="grid size-8 place-items-center rounded-full hover:bg-chip">
            ×
          </button>
        </div>
      )}

      {ai && (
        <div data-reader-ui>
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
        </div>
      )}

      {chat && (
        <ChatPanel
          key={id}
          bookId={id}
          paper={Boolean(book?.paperId)}
          onClose={() => setChat(false)}
          getPosition={() => {
            const el = scroller.current;
            const current = pageEls()[page - 1];
            const seen = el && current ? (el.scrollTop + el.clientHeight - current.offsetTop) / current.offsetHeight : 1;
            return { sectionIndex: page - 1, sectionFraction: Math.min(1, Math.max(0, seen)) };
          }}
          quote={chatQuote}
          onQuoteUsed={() => setChatQuote(null)}
          onCite={(cite: Cite) => {
            if (cite.page) goToPage(cite.page);
            else if (cite.section) {
              const entry = flat.find((e) => e.label.startsWith(`${cite.section} `) || e.label === cite.section);
              if (entry) goToPage(entry.page);
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * One page: a placeholder of the right size that renders (canvas and text layer) only while it's
 * near the viewport, and lets go of its canvas when far away, so long PDFs stay light.
 */
const PdfPage = memo(function PdfPage({
  doc,
  n,
  width,
  height,
  scale,
  filter,
  blank,
  blend,
  highlights,
  root,
}: {
  doc: PDFDocumentProxy;
  n: number;
  width: number;
  height: number;
  scale: number;
  filter: string;
  blank: string;
  blend: "multiply" | "screen";
  highlights: Highlight[];
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const el = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: "150% 0px",
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | undefined;
    let layer: { cancel: () => void } | undefined;
    const target = canvas.current!;
    const textEl = text.current!;

    (async () => {
      const page = await doc.getPage(n);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      target.width = Math.floor(viewport.width * dpr);
      target.height = Math.floor(viewport.height * dpr);
      task = page.render({ canvas: target, viewport, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      await task.promise;
      if (cancelled) return;
      const { TextLayer } = await loadPdfjs();
      textEl.replaceChildren();
      const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: textEl, viewport });
      layer = textLayer;
      await textLayer.render();
    })().catch((error: Error) => {
      if (error?.name !== "RenderingCancelledException" && !cancelled) console.warn(`Page ${n} didn't render`, error);
    });

    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      target.width = 0;
      target.height = 0;
      textEl.replaceChildren();
    };
  }, [doc, n, scale, near]);

  return (
    <div
      ref={el}
      data-page={n}
      className="relative shrink-0 overflow-hidden rounded-sm shadow-[0_10px_30px_-12px_rgb(0_0_0/0.35)]"
      style={
        {
          width,
          height,
          background: blank,
          "--total-scale-factor": scale,
          "--scale-round-x": "1px",
          "--scale-round-y": "1px",
        } as React.CSSProperties
      }
    >
      <canvas ref={canvas} className="absolute inset-0 size-full" style={{ filter }} />
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {highlights.flatMap((note) =>
          (note.rects ?? []).map(([l, t, w, h], i) => (
            <span
              key={`${note.id}-${i}`}
              className="absolute rounded-[2px]"
              style={{
                left: `${l * 100}%`,
                top: `${t * 100}%`,
                width: `${w * 100}%`,
                height: `${h * 100}%`,
                background: HIGHLIGHT_HEX[note.color],
                mixBlendMode: blend,
                opacity: blend === "screen" ? 0.45 : 0.75,
              }}
            />
          )),
        )}
      </div>
      <div ref={text} className="textLayer" />
    </div>
  );
});

/** Search the PDF's text page by page; each match jumps to its page. */
function PdfSearch({
  numPages,
  getText,
  label,
  onGo,
}: {
  numPages: number;
  getText: (n: number) => Promise<string>;
  label: (n: number) => string | undefined;
  onGo: (page: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ page: number; pre: string; match: string; post: string }[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const run = useRef(0);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim().toLowerCase();
    const id = ++run.current;
    setResults([]);
    if (q.length < 2) return;
    const found: typeof results = [];
    for (let n = 1; n <= numPages && found.length < 300; n++) {
      if (id !== run.current) return;
      const text = (await getText(n)).replace(/\s+/g, " ");
      const lower = text.toLowerCase();
      for (let at = lower.indexOf(q); at >= 0 && found.length < 300; at = lower.indexOf(q, at + q.length)) {
        found.push({ page: n, pre: text.slice(Math.max(0, at - 40), at), match: text.slice(at, at + q.length), post: text.slice(at + q.length, at + q.length + 40) });
      }
      if (n % 5 === 0 || n === numPages) {
        setProgress(n / numPages);
        setResults([...found]);
      }
    }
    setProgress(null);
    setResults([...found]);
  };

  const pages = [...new Set(results.map((r) => r.page))];

  return (
    <div>
      <form onSubmit={search} className="sticky top-0 z-10 px-1 pb-3">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search this PDF"
          aria-label="Search this PDF"
          className="w-full rounded-full bg-chip px-4 py-2.5 outline-none focus:ring-2 focus:ring-accent/40"
        />
        <p className="mt-2 px-2 text-xs text-muted" aria-live="polite">
          {progress !== null ? `Searching… ${Math.round(progress * 100)}%` : query && results.length ? `${results.length} matches` : ""}
        </p>
      </form>
      {pages.map((page) => (
        <section key={page} className="mb-3">
          <h3 className="px-3 py-1 text-[11px] tracking-[0.12em] text-muted uppercase">
            Page {page}
            {label(page) ? ` · ${label(page)}` : ""}
          </h3>
          <ul>
            {results
              .filter((r) => r.page === page)
              .map((r, i) => (
                <li key={i}>
                  <button onClick={() => onGo(page)} className="w-full rounded-xl px-3 py-2 text-left text-sm leading-snug hover:bg-chip">
                    …{r.pre}
                    <mark className="rounded bg-accent/25 px-0.5 text-inherit">{r.match}</mark>
                    {r.post}…
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** Theme and zoom. PDFs keep their own typography, so there are no font settings. */
function PdfSettingsPanel({
  settings,
  onChange,
  onZoom,
}: {
  settings: PdfSettings;
  onChange: (s: PdfSettings) => void;
  onZoom: (step: number) => void;
}) {
  return (
    <div className="reader-surface reader-pop fixed top-16 right-3 z-50 w-[min(20rem,calc(100%-1.5rem))] space-y-5 rounded-3xl p-5" role="dialog" aria-label="View settings">
      <div className="grid grid-cols-4 gap-2">
        {(Object.keys(THEMES) as ThemeName[]).map((name) => (
          <button
            key={name}
            onClick={() => onChange({ ...settings, theme: name })}
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
      <div>
        <p className="flex justify-between text-xs text-muted">
          Zoom
          <span className="tabular-nums">{Math.round(settings.zoom * 100)}%</span>
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button onClick={() => onZoom(-1)} aria-label="Zoom out" className="grid size-9 place-items-center rounded-full bg-chip text-lg hover:bg-line">
            −
          </button>
          <button
            onClick={() => onChange({ ...settings, zoom: 1 })}
            aria-pressed={settings.zoom === 1}
            className="flex-1 rounded-full border border-line py-2 text-sm transition-colors aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-fg"
          >
            Fit width
          </button>
          <button onClick={() => onZoom(1)} aria-label="Zoom in" className="grid size-9 place-items-center rounded-full bg-chip text-lg hover:bg-line">
            +
          </button>
        </div>
      </div>
    </div>
  );
}
