"use client";

import { createContext, use, useCallback, useEffect, useMemo, useState } from "react";
import type { Item } from "@/lib/types";
import { BookDialog } from "./book-dialog";

type ShelfContextValue = {
  items: Item[];
  /** The bookcase's search text. */
  query: string;
  setQuery: (query: string) => void;
  /**
   * Opens a book (or closes the dialog with null). Pass the list it was opened from
   * (e.g. the filtered library) to let the dialog step through it with previous/next.
   */
  openBook: (id: string | null, sequence?: string[]) => void;
  /**
   * Once known: which shelf books have an EPUB or PDF (keyed by shelf item id), and whether the
   * visitor is the signed-in owner who can open them without the password.
   */
  library: { owner: boolean; epubs: Map<string, Epub> } | null;
};

/** A book's EPUB or PDF, and (for the owner) how far through it they are. */
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
  const [openId, setOpenId] = useState<string | null>(null);
  const [sequence, setSequence] = useState<string[]>([]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [library, setLibrary] = useState<ShelfContextValue["library"]>(null);
  // Bumped after a file is added or removed, to ask again.
  const [libraryVersion, setLibraryVersion] = useState(0);

  // The page is static and public; only after it loads do we learn which books can be read.
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
        setLibrary({ owner: me.owner, epubs });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [libraryVersion]);

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
    () => ({ items, query, setQuery, openBook, library }),
    [items, query, openBook, library],
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
        owner={library?.owner}
        onFileChanged={() => setLibraryVersion((v) => v + 1)}
        onOpen={openBook}
        onClose={() => openBook(null)}
      />
    </ShelfContext>
  );
}
