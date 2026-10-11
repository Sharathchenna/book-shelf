"use client";

import type { Highlight, HighlightColor } from "@/lib/library-types";
import { HIGHLIGHT_HEX } from "./foliate";

/** Pieces shared by the EPUB and PDF readers. */

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
      className="grid size-9 shrink-0 place-items-center rounded-full transition-colors hover:bg-chip disabled:opacity-40 aria-pressed:bg-chip"
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
