"use client";

import { useMemo, useState } from "react";
import { colourFamily } from "@/lib/color";
import { STATUS_LABEL } from "@/lib/shelf";
import type { Item, Status } from "@/lib/types";
import { Cover } from "./cover";
import { useShelf } from "./shelf-provider";
import { Stars } from "./stars";

const PAGE_SIZE = 60;

const STATUS_TABS: [Status | "all", string][] = [
  ["all", "Everything"],
  ["read", "Read"],
  ["reading", "Reading"],
  ["to-read", "To read"],
];

const activity = (i: Item) => i.dateRead ?? i.dateAdded ?? "";
const lastName = (i: Item) => i.author.split(" ").at(-1) ?? i.author;

const SORTS = {
  recent: {
    label: "Recent",
    compare: (a: Item, b: Item) =>
      Number(b.status === "reading") - Number(a.status === "reading") || activity(b).localeCompare(activity(a)),
  },
  rating: { label: "Top rated", compare: (a: Item, b: Item) => (b.rating ?? 0) - (a.rating ?? 0) },
  title: { label: "Title", compare: (a: Item, b: Item) => a.title.localeCompare(b.title) },
  author: { label: "Author", compare: (a: Item, b: Item) => lastName(a).localeCompare(lastName(b)) },
  year: { label: "Newest", compare: (a: Item, b: Item) => (b.year ?? -Infinity) - (a.year ?? -Infinity) },
};
type SortKey = keyof typeof SORTS;

function matches(item: Item, terms: string[]): boolean {
  const haystack = [item.title, item.series, item.author, item.category, ...item.subjects, ...item.tags]
    .join(" ")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

export function Library() {
  const { items, query, setQuery, category, setCategory, colour, setColour, openBook, library } = useShelf();
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<SortKey>("recent");
  const [limit, setLimit] = useState(PAGE_SIZE);

  const filtered = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return items.filter(
      (i) =>
        (status === "all" || i.status === status) &&
        (!colour || colourFamily(i.color) === colour) &&
        matches(i, terms),
    );
  }, [items, status, colour, query]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of filtered) counts.set(i.category, (counts.get(i.category) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  // A category chosen before the filters changed may no longer have any books.
  const activeCategory = category && categories.some(([c]) => c === category) ? category : null;
  const shown = useMemo(
    () =>
      (activeCategory ? filtered.filter((i) => i.category === activeCategory) : filtered).toSorted(
        SORTS[sort].compare,
      ),
    [filtered, activeCategory, sort],
  );
  const ids = shown.map((i) => i.id);
  const filtersActive = status !== "all" || query !== "" || activeCategory !== null || colour !== null;

  // Every filter change starts from the first page, and brings the grid back into view
  // when the sticky filter bar is being used from further down the page.
  const update = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setLimit(PAGE_SIZE);
    const library = document.getElementById("library");
    if (library && library.getBoundingClientRect().top < 0) library.scrollIntoView({ block: "start" });
  };

  const clearFilters = () => {
    setStatus("all");
    setCategory(null);
    setColour(null);
    setQuery("");
    setLimit(PAGE_SIZE);
  };

  return (
    <section id="library" aria-label="Library" className="scroll-mt-24">
      <div className="glass sticky top-[5.25rem] z-30 flex flex-col gap-2 rounded-[22px] bg-(--panel-strong) p-1.5 md:flex-row md:items-center md:rounded-full">
        <div className="flex overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none]">
          {STATUS_TABS.map(([value, label]) => (
            <button
              key={value}
              onClick={() => update(setStatus)(value)}
              aria-pressed={status === value}
              className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium text-muted transition-all hover:text-fg aria-pressed:bg-bg aria-pressed:text-fg aria-pressed:shadow-sm"
            >
              {label}
            </button>
          ))}
        </div>
        <label className="flex flex-1 items-center gap-2 rounded-full bg-chip px-4 transition-shadow focus-within:ring-2 focus-within:ring-accent/40">
          <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="6.5" />
            <path d="m16 16 4 4" strokeLinecap="round" />
          </svg>
          <input
            value={query}
            onChange={(e) => update(setQuery)(e.target.value)}
            placeholder="Filter by title, author, subject"
            aria-label="Filter books"
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none placeholder:text-muted"
          />
          {query && (
            <button
              onClick={() => update(setQuery)("")}
              aria-label="Clear filter"
              className="grid size-6 place-items-center rounded-full text-muted hover:bg-line hover:text-fg"
            >
              ×
            </button>
          )}
        </label>
        <select
          value={sort}
          onChange={(e) => update(setSort)(e.target.value as SortKey)}
          aria-label="Sort"
          className="cursor-pointer rounded-full bg-chip px-4 py-2.5 text-sm font-medium outline-none"
        >
          {Object.entries(SORTS).map(([key, { label }]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2 [mask-image:linear-gradient(90deg,#000_92%,transparent)] [scrollbar-width:none]">
        {[["All", filtered.length] as const, ...categories].map(([name, count]) => {
          const value = name === "All" ? null : name;
          return (
            <button
              key={name}
              onClick={() => update(setCategory)(value)}
              aria-pressed={activeCategory === value}
              className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-sm transition-colors hover:bg-chip aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-fg"
            >
              {name} <span className="ml-0.5 text-xs opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex h-8 items-center justify-between text-sm text-muted">
        <p aria-live="polite">
          {shown.length.toLocaleString("en-US")} {shown.length === 1 ? "book" : "books"}
          {query && (
            <>
              {" "}
              matching <span className="text-fg">“{query}”</span>
            </>
          )}
          {colour && (
            <>
              {" "}
              with <span className="text-fg">{colour.toLowerCase()}</span> covers
            </>
          )}
        </p>
        {filtersActive && (
          <button onClick={clearFilters} className="rounded-full px-3 py-1 hover:bg-chip hover:text-fg">
            Clear filters
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-center">
          <p className="font-serif text-3xl">Nothing on the shelf matches that.</p>
          <p className="mt-2 text-muted">Try a different word, or widen the filters.</p>
          <button onClick={clearFilters} className="pill mt-6">
            Clear filters
          </button>
        </div>
      ) : (
        <ul
          onKeyDown={moveFocus}
          className="mt-4 grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
        >
          {shown.slice(0, limit).map((item) => (
            <li key={item.id}>
              <BookCard item={item} readable={library?.epubs.has(item.id)} onOpen={() => openBook(item.id, ids)} />
            </li>
          ))}
        </ul>
      )}

      {shown.length > limit && (
        <div className="mt-12 flex justify-center">
          <button onClick={() => setLimit((l) => l + PAGE_SIZE * 4)} className="pill">
            Show {Math.min(PAGE_SIZE * 4, shown.length - limit)} more of {shown.length - limit}
          </button>
        </div>
      )}
    </section>
  );
}

/** Arrow keys move between covers like a grid; the column count is read from the layout. */
function moveFocus(e: React.KeyboardEvent<HTMLUListElement>) {
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(":scope > li > button")];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  const firstRowTop = buttons[0].getBoundingClientRect().top;
  const columns = buttons.filter((b) => b.getBoundingClientRect().top === firstRowTop).length;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[e.key];
  const next = step ? buttons[index + step] : undefined;
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/** `readable`: the book has an EPUB or PDF to open from its card. */
function BookCard({ item, readable, onOpen }: { item: Item; readable?: boolean; onOpen: () => void }) {
  return (
    <button onClick={onOpen} className="group w-full rounded-md text-left">
      <div className="relative transition-transform duration-300 group-hover:-translate-y-1.5">
        <Cover item={item} tilt className="group-hover:shadow-[0_26px_40px_-18px_rgb(0_0_0/0.6)]" />
        {item.status !== "read" && (
          <span
            className={`absolute top-2 right-2 rounded-full px-2 py-0.5 text-[10px] font-semibold text-white shadow ${
              item.status === "reading" ? "bg-accent" : "bg-black/55 backdrop-blur"
            }`}
          >
            {STATUS_LABEL[item.status]}
          </span>
        )}
        {readable && (
          <span
            title="Readable here"
            className="glass absolute right-2 bottom-2 grid size-8 place-items-center rounded-full text-fg"
          >
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
              <path d="M12 7c-2-1.5-5-2-8-1.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12c-3-.5-6 0-8 1.5zM12 7v12" />
            </svg>
            <span className="sr-only">Readable here</span>
          </span>
        )}
      </div>
      <p className="mt-3 line-clamp-2 text-sm leading-snug font-semibold">{item.title}</p>
      <p className="mt-0.5 truncate text-sm text-muted">{item.author}</p>
      <Stars rating={item.rating} className="mt-1 block text-xs" />
    </button>
  );
}
