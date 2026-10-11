"use client";

import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { ColourFamily } from "@/lib/color";
import type { Item } from "@/lib/types";
import { BookDialog } from "./book-dialog";

type ShelfContextValue = {
  items: Item[];
  /** Text filter shared by the hero search box and the library filter. */
  query: string;
  setQuery: (query: string) => void;
  /** Library category filter; the catalog suggestions can set it too. */
  category: string | null;
  setCategory: (category: string | null) => void;
  /** Library cover-colour filter, set from "Browse by colour". */
  colour: ColourFamily | null;
  setColour: (colour: ColourFamily | null) => void;
  /**
   * Opens a book (or closes the dialog with null). Pass the list it was opened from
   * (e.g. the filtered library) to let the dialog step through it with previous/next.
   */
  openBook: (id: string | null, sequence?: string[]) => void;
  /**
   * The reading room, once known: which shelf books have an EPUB or PDF there (keyed by shelf
   * item id), and whether the visitor is the signed-in owner who can open them.
   */
  library: { owner: boolean; size: number; epubs: Map<string, Epub> } | null;
};

/** A book in the reading room, and (for the owner) how far through it they are. */
export type Epub = { id: string; fraction: number };

const ShelfContext = createContext<ShelfContextValue | null>(null);

/** The shelf context when rendered inside <ShelfProvider> (the home page), otherwise null. */
export function useOptionalShelf() {
  return use(ShelfContext);
}

export function useShelf() {
  const value = use(ShelfContext);
  if (!value) throw new Error("useShelf must be used inside <ShelfProvider>");
  return value;
}

export function ShelfProvider({ items, children }: { items: Item[]; children: React.ReactNode }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [colour, setColour] = useState<ColourFamily | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [library, setLibrary] = useState<ShelfContextValue["library"]>(null);

  // The page is static and public; only after it loads do we learn what's in the reading room.
  useEffect(() => {
    let current = true;
    void fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { owner: boolean; library?: { id: string; shelfItemId?: string; fraction: number }[] } | null) => {
        if (!current || !me) return;
        const epubs = new Map<string, Epub>();
        for (const book of me.library ?? []) {
          if (book.shelfItemId) epubs.set(book.shelfItemId, { id: book.id, fraction: book.fraction });
        }
        setLibrary({ owner: me.owner, size: me.library?.length ?? 0, epubs });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  // ?book=<id> links open that book. Read after hydration: the URL is not known while prerendering.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("book");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the URL once on mount
    if (id && byId.has(id)) setOpenId(id);
  }, [byId]);

  const openBook = useCallback((id: string | null, nextSequence?: string[]) => {
    setOpenId(id);
    if (nextSequence) setSequence(nextSequence);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("book", id);
    else url.searchParams.delete("book");
    window.history.replaceState(null, "", url);
  }, []);

  const value = useMemo(
    () => ({ items, query, setQuery, category, setCategory, colour, setColour, openBook, library }),
    [items, query, category, colour, openBook, library],
  );

  const item = openId ? (byId.get(openId) ?? null) : null;
  const position = item ? sequence.indexOf(item.id) : -1;
  const sameAuthor = item ? items.filter((i) => i.author === item.author && i.id !== item.id).slice(0, 8) : [];

  return (
    <ShelfContext value={value}>
      {children}
      <BookDialog
        item={item}
        prevId={position > 0 ? sequence[position - 1] : undefined}
        nextId={position >= 0 ? sequence[position + 1] : undefined}
        sameAuthor={sameAuthor}
        epub={item ? library?.epubs.get(item.id) : undefined}
        locked={!library?.owner}
        onOpen={openBook}
        onClose={() => openBook(null)}
      />
    </ShelfContext>
  );
}
