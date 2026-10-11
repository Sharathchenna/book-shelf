"use client";

import { useSyncExternalStore } from "react";
import type { Highlight, HighlightColor, LibraryBook } from "@/lib/library-types";
import { HIGHLIGHT_HEX } from "./foliate";

/** Pieces shared by the EPUB and PDF readers. */

/** Where the reader's back button goes: the book's card on the shelf, or the papers page. */
export function backHref(book: Pick<LibraryBook, "id" | "shelfItemId" | "paperId"> | null): string {
  if (book?.shelfItemId) return `/?book=${book.shelfItemId}`;
  return book?.paperId ? "/papers" : "/";
}

/** A selection (or a clicked highlight) and where to show its popover. */
export type Selected = {
  x: number;
  y: number;
  text: string;
  cfi: string;
  sectionIndex: number;
  sectionFraction: number;
  /** Set when the popover is for an existing highlight. */
  noteId?: string;
};

export function SelectionPopover({
  selected,
  note,
  draft,
  onDraft,
  onHighlight,
  onSaveNote,
  onExplain,
  onAsk,
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
  /** Opens the chat with this passage quoted. */
  onAsk?: () => void;
  onCopy: () => void;
  onRemove?: () => void;
}) {
  // Keep the popover on screen; flip below the selection when it's near the top.
  const below = selected.y < 150;
  // Centred on the selection, but at least 12px from either edge of the screen.
  const half = Math.min(176, (window.innerWidth - 24) / 2);
  const x = Math.min(Math.max(selected.x, half + 12), window.innerWidth - half - 12);

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
        <div className="flex flex-wrap items-center justify-center gap-0.5">
          {(Object.keys(HIGHLIGHT_HEX) as HighlightColor[]).map((color) => (
            <button
              key={color}
              onClick={() => onHighlight(color)}
              aria-label={`Highlight ${color}`}
              aria-pressed={note?.color === color}
              className="grid size-8 place-items-center rounded-full hover:bg-chip sm:size-9"
            >
              <span
                className="size-5 rounded-full ring-1 ring-black/10 [[aria-pressed=true]>&]:ring-2 [[aria-pressed=true]>&]:ring-fg"
                style={{ background: HIGHLIGHT_HEX[color] }}
              />
            </button>
          ))}
          <span className="mx-0.5 h-6 w-px bg-line sm:mx-1" />
          <PopButton onClick={() => onDraft(note?.note ?? "")}>{note?.note ? "Edit note" : "Note"}</PopButton>
          <PopButton onClick={onExplain} accent>
            Explain
          </PopButton>
          {onAsk && <PopButton onClick={onAsk}>Ask</PopButton>}
          {onRemove ? <PopButton onClick={onRemove}>Remove</PopButton> : !onAsk && <PopButton onClick={onCopy}>Copy</PopButton>}
        </div>
      )}
    </div>
  );
}

function PopButton({ onClick, accent, children }: { onClick: () => void; accent?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${accent ? "text-accent hover:bg-accent/10" : "hover:bg-chip"}`}
    >
      {accent && <span aria-hidden>✦ </span>}
      {children}
    </button>
  );
}

export function BarButton({
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
      className="grid size-8 shrink-0 place-items-center rounded-full transition-colors hover:bg-chip disabled:opacity-40 aria-pressed:bg-chip sm:size-9"
    >
      {children}
    </button>
  );
}

export function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/** Shown while a book downloads and lays out: a book whose pages flip. */
export function OpeningBook({ label = "Opening your book…" }: { label?: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center" role="status" aria-label="Opening the book">
      <div className="flex flex-col items-center gap-5">
        <div className="reader-opening relative h-16 w-24 [perspective:400px]">
          <span className="absolute inset-y-0 left-0 w-1/2 rounded-l-md bg-fg/10" />
          <span className="absolute inset-y-0 right-0 w-1/2 rounded-r-md bg-fg/10" />
          <span className="page absolute inset-y-0 right-0 w-1/2 origin-left rounded-r-md bg-fg/20" />
        </div>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}

const WIDE = "(min-width: 1024px)";

/** Whether the chat sits beside the page (wide screens) rather than over it. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = matchMedia(WIDE);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => matchMedia(WIDE).matches,
    () => false,
  );
}

/** Room the open chat takes on the right of a wide screen: its width plus the gaps around it. */
export const CHAT_SPACE = "27.5rem";

export function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M5 5h14v10H10l-4 4v-4H5z" />
    </svg>
  );
}
