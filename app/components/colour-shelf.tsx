"use client";

import { COLOUR_FAMILIES, colourFamily, hsl, type ColourFamily } from "@/lib/color";
import type { Item } from "@/lib/types";
import { useShelf } from "./shelf-provider";

/** Every cover's colour, sorted round the colour wheel (greys last), with a filter per colour family. */
export function ColourShelf() {
  const { items, colour, setColour, setCategory, openBook } = useShelf();

  const sorted = items
    .map((item) => ({ item, family: colourFamily(item.color), ...hsl(item.color) }))
    .toSorted((a, b) => {
      const aNeutral = a.family === "Neutrals";
      const bNeutral = b.family === "Neutrals";
      if (aNeutral !== bNeutral) return aNeutral ? 1 : -1;
      return aNeutral ? b.l - a.l : a.h - b.h;
    });
  const ids = sorted.map(({ item }) => item.id);
  const counts = new Map<ColourFamily, number>();
  for (const { family } of sorted) counts.set(family, (counts.get(family) ?? 0) + 1);

  const choose = (family: ColourFamily) => {
    setCategory(null);
    setColour(colour === family ? null : family);
    document.getElementById("library")?.scrollIntoView({ block: "start" });
  };

  return (
    <div className="glass min-w-0 rounded-3xl p-6">
      <h3 className="font-serif text-2xl">Browse by colour</h3>
      <p className="mt-1 text-sm text-muted">Every cover, round the colour wheel. For when you remember the cover, not the title.</p>

      <div className="mt-6 flex h-20 overflow-hidden rounded-xl shadow-inner ring-1 ring-line">
        {sorted.map(({ item }) => (
          <Bar key={item.id} item={item} onOpen={() => openBook(item.id, ids)} />
        ))}
      </div>

      <ul className="mt-4 flex flex-wrap gap-2">
        {COLOUR_FAMILIES.filter(({ name }) => counts.get(name)).map(({ name, swatch }) => (
          <li key={name}>
            <button
              onClick={() => choose(name)}
              aria-pressed={colour === name}
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1 text-sm transition-colors hover:bg-chip aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-ink-fg"
            >
              <span className="size-3 rounded-full ring-1 ring-black/15" style={{ background: swatch }} />
              {name}
              <span className="text-xs opacity-60">{counts.get(name)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bar({ item, onOpen }: { item: Item; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={`${item.title} · ${item.author}`}
      aria-label={item.title}
      className="h-full min-w-[3px] flex-1 transition-[flex-grow] duration-200 hover:flex-[6]"
      style={{ backgroundColor: item.color }}
    />
  );
}
