"use client";

import { hashString, textOn } from "@/lib/color";
import type { Item } from "@/lib/types";
import { useShelf } from "./shelf-provider";

/** Wide enough that one copy of the row always fills the screen, so the loop never shows a gap. */
const MIN_ROW_WIDTH = 2600;

export function SpineRow({ items, reverse = false }: { items: Item[]; reverse?: boolean }) {
  const { openBook } = useShelf();
  if (!items.length) return null;

  const ids = items.map((i) => i.id);
  const oneCopy = items.reduce((sum, item) => sum + spineWidth(item) + 3, 0);
  const repeats = Math.max(1, Math.ceil(MIN_ROW_WIDTH / oneCopy));
  const row = Array.from({ length: repeats }, () => items).flat();

  return (
    <div
      className="spine-row"
      data-reverse={reverse || undefined}
      style={{ "--duration": `${row.length * 2.4}s` } as React.CSSProperties}
    >
      <div className="spine-track">
        {/* The second half duplicates the first so the -50% loop is seamless; it is hidden from assistive tech. */}
        {[0, 1].map((half) =>
          row.map((item, i) => (
            <Spine
              key={`${half}-${i}`}
              item={item}
              duplicate={half === 1 || i >= items.length}
              onOpen={() => openBook(item.id, ids)}
            />
          )),
        )}
      </div>
      <div className="spine-ledge" />
    </div>
  );
}

function Spine({ item, duplicate, onOpen }: { item: Item; duplicate: boolean; onOpen: () => void }) {
  const hash = hashString(item.id);
  const serif = hash % 2 === 0;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-hidden={duplicate || undefined}
      tabIndex={duplicate ? -1 : undefined}
      title={`${item.title} · ${item.author}`}
      className="spine"
      data-band={hash % 3 === 0 || undefined}
      style={{
        width: `calc(${spineWidth(item)}px * var(--spine-scale))`,
        height: `calc(${150 + (hash % 7) * 8}px * var(--spine-scale))`,
        backgroundColor: item.color,
        color: textOn(item.color),
      }}
    >
      <span
        className={`spine-title ${
          serif ? "font-serif text-[14px] italic" : "text-[11px] font-semibold tracking-[0.08em] uppercase"
        }`}
      >
        {item.title}
      </span>
    </button>
  );
}

function spineWidth(item: Item): number {
  return Math.round(Math.min(56, Math.max(28, 24 + (item.pages ?? 300) / 26)));
}
