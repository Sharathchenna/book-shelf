"use client";

import { useRouter } from "next/navigation";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, ViewTransition } from "react";
import { hostOf, SORTS, sortBooks, TAGS, TOPIC, TOPICS, type ShelfBook as Book, type Sort, type TagKey, type Topic, type TopicKey } from "@/lib/bookcase";
import { useOptionalShelf } from "../shelf-provider";
import { Glyph } from "./book";
import { BookOpen, type BookActions, type Origin } from "./book-open";
import { ChevronLeft, ChevronRight, LayoutGrid, LibraryIcon, Search, X } from "./icons";
import { ExportNotes } from "./export-notes";
import { Shelf } from "./shelf";
import { TopicGrid, TopicPage } from "./topics";

type View = "shelf" | "topics";

/** What /api/me says about each file: whose it is, and for the owner how far in and how marked. */
type MeFile = { id: string; shelfItemId?: string; paperId?: string; clipId?: string; fraction: number; highlights?: number };

/**
 * The home page: every book and clipping, sorted onto topics. The bookcase arranges by topic,
 * recency, colour or length; the topics view opens each subject into a display of covers. Any
 * book comes off the shelf into your hands, and from there into the reader. The page is the same
 * for everyone; once it loads, the owner's browser lays their reading over it (/api/me).
 */
export function Library({ owner, books: initial, aside }: { owner: string; books: Book[]; aside?: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<{ owner: boolean; files: MeFile[] } | null>(null);
  const [edits, setEdits] = useState<Record<string, { topic?: TopicKey; favorite?: boolean; removed?: boolean }>>({});

  const [view, setView] = useState<View>("shelf");
  const [topic, setTopic] = useState<TopicKey | null>(null);
  const [only, setOnly] = useState<TopicKey | null>(null);
  const [tag, setTag] = useState<TagKey | null>(null);
  const [sort, setSort] = useState<Sort>("topic");
  // Inside the shelf's provider, the search text is kept there.
  const shelf = useOptionalShelf();
  const [localQ, setLocalQ] = useState("");
  const q = shelf ? shelf.query : localQ;
  const setQ = shelf ? shelf.setQuery : setLocalQ;
  const [open, setOpen] = useState<{ id: string; origin: Origin } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let current = true;
    void fetch("/api/me")
      .then((res) => (res.ok ? (res.json() as Promise<{ owner: boolean; library?: MeFile[] }>) : null))
      .then((data) => current && data && setMe({ owner: data.owner, files: data.library ?? [] }))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  // Coming back to the page (the browser's back button) finds it as it was left.
  useEffect(() => {
    const show = (e: PageTransitionEvent) => e.persisted && setLeaving(false);
    window.addEventListener("pageshow", show);
    return () => window.removeEventListener("pageshow", show);
  }, []);

  const isOwner = Boolean(me?.owner);
  const books = useMemo(() => {
    const fileOf = new Map<string, MeFile>();
    for (const f of me?.files ?? []) {
      const of = f.paperId ?? f.clipId ?? f.shelfItemId;
      if (of && !fileOf.has(of)) fileOf.set(of, f);
    }
    return initial.flatMap((b): Book[] => {
      const edit = edits[b.id];
      if (edit?.removed) return [];
      const file = fileOf.get(b.id);
      // The owner's own place in a book wins over its Goodreads shelf, unless that says it's read.
      const measured = Boolean(isOwner && file && file.fraction > 0 && b.pct < 1);
      return [
        {
          ...b,
          ...(edit?.topic ? { topic: edit.topic } : {}),
          ...(edit?.favorite !== undefined ? { favorite: edit.favorite } : {}),
          fileId: file?.id ?? b.fileId,
          pct: measured ? Math.min(file!.fraction, 0.99) : b.pct,
          measured: measured || b.measured,
          highlights: file?.highlights ?? b.highlights,
        },
      ];
    });
  }, [initial, me, isOwner, edits]);

  const sorted = useMemo(() => sortBooks(books, sort), [books, sort]);

  const match = useCallback(
    (b: Book) => {
      const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const t = tag ? TAGS.find((x) => x.key === tag)! : null;
      return (!t || t.test(b)) && words.every((w) => `${b.title} ${b.author} ${TOPIC[b.topic].name} ${b.tags.join(" ")} ${b.year ?? ""}`.toLowerCase().includes(w));
    },
    [q, tag],
  );
  const shown = useMemo(() => new Set(sorted.filter((b) => (!only || b.topic === only) && match(b)).map((b) => b.id)), [sorted, only, match]);

  const topics = useMemo(
    () => TOPICS.map((t) => ({ topic: t, books: books.filter((b) => b.topic === t.key).sort((a, b) => b.added - a.added) })).filter((x) => x.books.length),
    [books],
  );

  const stats = useMemo(() => {
    const mins = books.reduce((n, b) => n + b.minutes, 0);
    return {
      books: books.filter((b) => b.kind === "book").length,
      clips: books.filter((b) => b.kind !== "book").length,
      topics: topics.filter((t) => t.topic.key !== "unsorted").length,
      hours: Math.max(1, Math.round(mins / 60)),
      reading: books.filter((b) => b.pct > 0 && b.pct < 1).length,
      read: books.filter((b) => b.pct >= 1).length,
    };
  }, [books, topics]);

  const top = useRef<HTMLDivElement>(null);
  const go = useCallback(
    (to: { view: View; topic?: TopicKey | null }) => {
      startTransition(() => {
        setView(to.view);
        setTopic(to.topic ?? null);
        setQ("");
        if (to.view === "shelf") setTag(null);
      });
      // Back to the top of the bookcase, which isn't the top of the page.
      const y = (top.current?.getBoundingClientRect().top ?? 0) + window.scrollY - 90;
      if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: "instant" as ScrollBehavior });
    },
    [setQ],
  );

  // "/" to search, wherever you are; Esc steps back out of a topic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || e.metaKey || e.ctrlKey || (e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable], dialog")) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Escape" && topic) go({ view: "topics" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, topic, go]);

  const read = useCallback(
    (_: Book, href: string) => {
      setLeaving(true);
      router.push(href);
    },
    [router],
  );

  const shelve = useCallback((b: Book, patch: { topic?: TopicKey; favorite?: boolean }) => {
    setEdits((e) => ({ ...e, [b.id]: { ...e[b.id], ...patch } }));
    void fetch("/api/shelving", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: b.id, ...patch }) }).then(
      (res) => {
        // Not saved: put it back as it was.
        if (!res.ok) setEdits((e) => ({ ...e, [b.id]: { ...e[b.id], ...(patch.topic ? { topic: undefined } : {}), ...(patch.favorite !== undefined ? { favorite: undefined } : {}) } }));
      },
    );
  }, []);

  const remove = useCallback((b: Book) => {
    if (!window.confirm(`Remove “${b.title}” from the library?`)) return;
    setOpen(null);
    setEdits((e) => ({ ...e, [b.id]: { ...e[b.id], removed: true } }));
    void fetch("/api/clips", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: b.id }) }).then(
      (res) => !res.ok && setEdits((e) => ({ ...e, [b.id]: { ...e[b.id], removed: false } })),
    );
  }, []);

  const openBook = open ? books.find((b) => b.id === open.id) ?? null : null;
  const T = topic ? TOPIC[topic] : null;
  const topicBooks = useMemo(() => (topic ? books.filter((b) => b.topic === topic).sort((a, b) => b.added - a.added).filter(match) : []), [topic, books, match]);
  const screen = topic ? `topic-${topic}` : view;

  const searchBox = (
    <label className="lib-search">
      <Search size={15} className="shrink-0 text-ink-4" />
      <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={T ? `Search ${T.name}` : "Search the library"} aria-label="Search the library" />
      {q ? (
        <button type="button" aria-label="Clear search" onClick={() => setQ("")} className="grid size-5 place-items-center rounded-full text-ink-3 hover:bg-sunk">
          <X size={13} />
        </button>
      ) : (
        <kbd className="max-sm:hidden">/</kbd>
      )}
    </label>
  );

  const tagChips = (pool: Book[]) =>
    TAGS.map((t) => {
      const n = pool.filter(t.test).length;
      // A kind that's everything on the shelf filters nothing.
      if (!n || (!t.icon && n === pool.length)) return null;
      return (
        <Chip key={t.key} on={tag === t.key} onClick={() => setTag(tag === t.key ? null : t.key)}>
          {t.icon && <Glyph k={t.icon} size={18} />} {t.label} <span className="lib-n">{n}</span>
        </Chip>
      );
    });

  return (
    <div ref={top} id="library" className={`library relative z-[1] scroll-mt-24 transition-[opacity,filter] duration-300 ${leaving ? "opacity-0 blur-[2px]" : ""}`}>
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-16 sm:px-8">
        {!T && (
          <section className="lib-hero">
            <div className="lib-hero-row">
              <div className="min-w-0">
                <h1 className="lib-title">{owner}&apos;s library</h1>
                <p className="lib-stats">
                  <span>
                    <b>{stats.books}</b> {stats.books === 1 ? "book" : "books"}
                  </span>
                  {stats.clips > 0 && (
                    <span>
                      <b>{stats.clips}</b> {stats.clips === 1 ? "clipping" : "clippings"}
                    </span>
                  )}
                  {stats.topics > 0 && (
                    <span>
                      <b>{stats.topics}</b> {stats.topics === 1 ? "topic" : "topics"}
                    </span>
                  )}
                  <span>
                    <b>{stats.hours}</b> {stats.hours === 1 ? "hour" : "hours"} of reading
                  </span>
                  {stats.reading > 0 && (
                    <span>
                      <b>{stats.reading}</b> in progress
                    </span>
                  )}
                  {stats.read > 0 && (
                    <span>
                      <b>{stats.read}</b> read
                    </span>
                  )}
                </p>
              </div>
              {isOwner && <ExportNotes />}
            </div>
            {isOwner && aside}
          </section>
        )}

        {T ? (
          <div className="lib-tools is-topic">
            <button type="button" onClick={() => go({ view: "topics" })} className="lib-back">
              <ChevronLeft size={16} /> All topics
            </button>
          </div>
        ) : (
          <div className="lib-tools">
            <ViewSwitch view={view} onChange={(v) => go({ view: v })} />
            {searchBox}
            {view === "shelf" && (
              <div className="lib-sort" role="radiogroup" aria-label="Arrange by">
                <span className="px-2 text-[12.5px] text-ink-4 max-md:hidden">Arrange by</span>
                {SORTS.map((s) => (
                  <button key={s.key} type="button" role="radio" aria-checked={sort === s.key} onClick={() => setSort(s.key)}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "shelf" && !T && (
          <ChipRow label="Filter">
            <Chip on={!only && !tag} onClick={() => (setOnly(null), setTag(null))}>
              All <span className="lib-n">{books.length}</span>
            </Chip>
            {topics.map(({ topic: t, books: bs }) => (
              <Chip key={t.key} on={only === t.key} color={t.shades[0]} onClick={() => setOnly(only === t.key ? null : t.key)}>
                <Glyph k={t.key} size={18} /> {t.name} <span className="lib-n">{bs.length}</span>
              </Chip>
            ))}
            {TAGS.some((t) => books.some(t.test)) && <span aria-hidden className="mx-1.5 h-4 w-px shrink-0 self-center bg-rule-strong" />}
            {tagChips(books)}
          </ChipRow>
        )}

        <ViewTransition key={screen} enter="lib-enter" exit="lib-exit" default="none">
          <div className="lib-screen">
            {T ? (
              <TopicPage
                topic={T}
                books={topicBooks}
                tools={
                  <div className="lib-tools mt-8">
                    {searchBox}
                    <div className="lib-chips no-scrollbar">{tagChips(books.filter((b) => b.topic === T.key))}</div>
                  </div>
                }
                onOpen={(b, el) => setOpen({ id: b.id, origin: { el, kind: "cover" } })}
              />
            ) : view === "shelf" ? (
              <>
                <Shelf
                  books={sorted}
                  shown={shown}
                  sort={sort}
                  openId={open?.id ?? null}
                  fresh={NONE}
                  onOpen={(b, el) => setOpen({ id: b.id, origin: { el, kind: "spine" } })}
                  onLabel={sort === "topic" ? (k) => go({ view: "topics", topic: k as TopicKey }) : undefined}
                />
                {shown.size === 0 && books.length > 0 && (
                  <p className="py-6 text-center text-[14px] text-ink-3">Nothing on the shelves matches{q ? <> &ldquo;{q}&rdquo;</> : ""}.</p>
                )}
                <p className="lib-hint">Click a spine to take it down. Arrow keys walk the shelf.</p>
              </>
            ) : (
              <TopicGrid topics={topics} onPick={(t: Topic) => go({ view: "topics", topic: t.key })} />
            )}
          </div>
        </ViewTransition>
      </div>

      {open && openBook && (
        <BookOpen
          key={open.id}
          book={openBook}
          origin={open.origin}
          owner={owner}
          editable={isOwner}
          actions={actionsFor(openBook, isOwner, Boolean(shelf))}
          onRead={read}
          onDetails={(b) => shelf?.openBook(b.id)}
          onShelve={shelve}
          onRemove={remove}
          onClose={() => {
            const id = open.id;
            setOpen(null);
            requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-book="${id}"]`)?.focus({ preventScroll: true }));
          }}
        />
      )}
    </div>
  );
}

const NONE = new Set<string>();

/**
 * Where "Read" takes each kind of thing, for the owner and for visitors, and where it came from.
 * A book without a file opens its card (rating, review, more by the author) when there is one.
 */
function actionsFor(b: Book, owner: boolean, cards: boolean): BookActions {
  const started = b.pct >= 1 ? "Read again" : b.pct > 0 && b.measured ? "Continue reading" : "Start reading";
  const host = hostOf(b.url);
  const source = b.url ? { label: b.kind === "book" ? "Goodreads" : b.kind === "tweet" ? "X" : (host ?? "Source"), href: b.url } : undefined;
  if (b.kind === "book") {
    if (b.fileId) return { primary: { label: owner ? started : "Sign in to read", href: `/reader/${b.fileId}` }, source };
    return { primary: cards ? { label: "About this book", href: `/?book=${encodeURIComponent(b.id)}`, details: true } : undefined, source };
  }
  if (b.kind === "tweet" && !b.readable) return { primary: { label: "Open on X", href: b.url!, external: true } };
  if (owner && b.readable) {
    const href = b.kind === "paper" ? `/reader/paper/${encodeURIComponent(b.id)}` : `/reader/clip/${encodeURIComponent(b.id)}`;
    return { primary: { label: started, href }, source };
  }
  return { primary: { label: b.kind === "paper" ? "Read the paper" : "Read it", href: b.url!, external: true } };
}

/**
 * Filters on one line, however many topics there are: the row scrolls, fades
 * at an edge with more beyond it, and offers an arrow there to page along.
 */
function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ l: false, r: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () =>
      setEdges((e) => {
        const l = el.scrollLeft > 2;
        const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
        return e.l === l && e.r === r ? e : { l, r };
      });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    const mo = new MutationObserver(read);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener("scroll", read, { passive: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
      el.removeEventListener("scroll", read);
    };
  }, []);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(200, ref.current.clientWidth * 0.6), behavior: "smooth" });
  return (
    <div className="lib-chip-row" data-l={edges.l || undefined} data-r={edges.r || undefined}>
      <div ref={ref} className="lib-chips no-scrollbar" role="group" aria-label={label}>
        {children}
      </div>
      <button type="button" className="lib-chip-page is-l" aria-label="Scroll filters left" tabIndex={-1} onClick={() => page(-1)}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" className="lib-chip-page is-r" aria-label="Scroll filters right" tabIndex={-1} onClick={() => page(1)}>
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

function Chip({ on, color, onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className="lib-chip" style={color ? { ["--c" as string]: color } : undefined}>
      {children}
    </button>
  );
}

function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="lib-switch" role="radiogroup" aria-label="View" data-view={view}>
      <span className="lib-switch-pill" aria-hidden />
      <button type="button" role="radio" aria-checked={view === "shelf"} onClick={() => onChange("shelf")}>
        <LibraryIcon size={15} /> Shelf
      </button>
      <button type="button" role="radio" aria-checked={view === "topics"} onClick={() => onChange("topics")}>
        <LayoutGrid size={15} /> Topics
      </button>
    </div>
  );
}
