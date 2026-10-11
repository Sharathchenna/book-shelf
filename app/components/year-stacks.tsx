"use client";

import { hashString } from "@/lib/color";
import type { Item } from "@/lib/types";
import { useShelf } from "./shelf-provider";

/** Books finished each year, piled up: one flat book per read, so taller piles are bigger years. */
export function YearStacks({ years }: { years: [number, Item[]][] }) {
  const { openBook } = useShelf();
  if (!years.length) return null;

  const most = Math.max(...years.map(([, books]) => books.length));
  // Keep the tallest pile around 180px however many books a year holds.
  const thickness = Math.max(3, Math.min(10, Math.floor(180 / most)));

  return (
    <div className="glass min-w-0 rounded-3xl p-6">
      <h3 className="font-serif text-2xl">Year by year</h3>
      <p className="mt-1 text-sm text-muted">Books finished each year, piled up. Hover a book to see it.</p>

      <div className="mt-6 overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-3 border-b-2 border-fg/70 px-1">
          {years.map(([year, books]) => {
            const ids = books.map((b) => b.id);
            return (
              <div key={year} className="flex min-w-11 flex-1 flex-col items-center">
                <span className="mb-2 font-serif text-xl leading-none">{books.length}</span>
                <ul className="flex w-full flex-col-reverse items-center">
                  {books.map((book) => {
                    const hash = hashString(book.id);
                    return (
                      <li key={book.id} className="flex w-full justify-center">
                        <button
                          onClick={() => openBook(book.id, ids)}
                          title={`${book.title} · ${book.author}`}
                          aria-label={`${book.title}, read in ${year}`}
                          className="flat-book block transition-transform duration-200 hover:-translate-y-0.5 hover:scale-x-110"
                          style={{
                            height: thickness,
                            width: `${Math.min(100, Math.max(62, 50 + (book.pages ?? 300) / 12))}%`,
                            backgroundColor: book.color,
                            translate: `${((hash % 5) - 2) * 2}px 0`,
                          }}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="flex min-w-max gap-3 px-1 pt-2">
          {years.map(([year]) => (
            <span key={year} className="min-w-11 flex-1 text-center text-xs text-muted tabular-nums">
              {year}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
