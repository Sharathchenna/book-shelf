import { hashString } from "@/lib/color";
import { Suspense } from "react";
import { getClipKinds, getShelf } from "@/lib/data";
import { getStats, readsByYear } from "@/lib/shelf";
import type { ClipKind, Item } from "@/lib/types";
import { shelfConfig } from "@/shelf.config";
import type { Metadata } from "next";
import { AskHero, type Suggestion } from "../components/ask-hero";
import { ColourShelf } from "../components/colour-shelf";
import { ShelfEngine } from "../components/engine/shelf-engine";
import { Footer } from "../components/footer";
import { Library } from "../components/library";
import { Profile, Stats } from "../components/profile";
import { ShelfProvider } from "../components/shelf-provider";
import { SpineRow } from "../components/spine-row";
import { TopBar } from "../components/top-bar";
import { YearStacks } from "../components/year-stacks";

/** Two marquee rows from a stable shuffle, so neighbouring spines vary in colour and genre. */
function spineRows(items: Item[], perRow = 60): [Item[], Item[]] {
  const mixed = items.toSorted((a, b) => hashString(a.id) - hashString(b.id)).slice(0, perRow * 2);
  const half = Math.ceil(mixed.length / 2);
  return [mixed.slice(0, half), mixed.slice(half)];
}

/** One-tap searches drawn from the shelf itself: its biggest categories and most-read authors. */
function suggestions(items: Item[]): Suggestion[] {
  const top = (values: string[], n: number) => {
    const counts = new Map<string, number>();
    for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
    return [...counts]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value]) => value);
  };
  const generic = new Set(["Literary Fiction", "Nonfiction"]);
  const categories = top(
    items.map((i) => i.category).filter((c) => !generic.has(c)),
    4,
  ).map((label): Suggestion => ({ label, kind: "category" }));
  const authors = top(
    items.map((i) => i.author),
    2,
  ).map((label): Suggestion => ({ label, kind: "author" }));
  return [...categories, ...authors];
}

export const metadata: Metadata = { title: `Books · ${shelfConfig.owner}'s Shelf` };

/** The books from Goodreads: ask the shelf, the engine, stats, reading by year, and every cover. */
export default function Books() {
  return (
    <Suspense fallback={<Loading />}>
      <Shelf />
    </Suspense>
  );
}

/** The books come from the database as each request arrives. */
async function Shelf() {
  const [{ items, updatedAt }, kinds] = await Promise.all([getShelf(), getClipKinds()]);
  if (items.length === 0) return <EmptyShelf updatedAt={updatedAt} kinds={kinds} />;
  const [top] = spineRows(items);

  return (
    <ShelfProvider items={items}>
      <TopBar owner={shelfConfig.owner} current="books" kinds={kinds} />
      <main className="pt-6">
        <SpineRow items={top} />
        <AskHero owner={shelfConfig.owner} suggestions={suggestions(items)} />
        <section aria-label="The shelf engine" className="px-4">
          <ShelfEngine pagesTurned={getStats(items).pagesTurned} />
        </section>

        <div className="mx-auto mt-16 flex max-w-6xl flex-col gap-8 px-4">
          <Profile config={shelfConfig} updatedAt={updatedAt} />
          <Stats items={items} />
          <section id="insights" aria-label="Insights" className="grid scroll-mt-28 gap-4 lg:grid-cols-2">
            <YearStacks years={readsByYear(items)} />
            <ColourShelf />
          </section>
          <Library />
        </div>
      </main>
      <Footer owner={shelfConfig.owner} count={items.length} kinds={kinds} shortcuts />
    </ShelfProvider>
  );
}

/** While the shelf loads: the bar and the question, so the page never starts blank. */
function Loading() {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="books" kinds={[]} />
      <main className="pt-6" aria-busy>
        <div className="h-[178px] animate-pulse bg-chip/60" />
        <h1 className="mx-auto mt-20 max-w-3xl px-4 text-center font-serif text-5xl leading-[0.95] tracking-tight sm:text-7xl">
          What&apos;s on <em className="text-accent">{shelfConfig.owner}&apos;s</em> shelf?
        </h1>
      </main>
    </>
  );
}

/** Before the first sync: no search, stats or library, which would only show zeros. */
function EmptyShelf({ updatedAt, kinds }: { updatedAt: string; kinds: ClipKind[] }) {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="books" kinds={kinds} />
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pt-14">
        <div className="glass rounded-3xl px-6 py-16 text-center">
          <h1 className="font-serif text-5xl leading-tight text-balance sm:text-6xl">The shelf is being stocked.</h1>
          <p className="mx-auto mt-4 max-w-md text-muted">
            {shelfConfig.owner}&apos;s books are on their way. Check back soon.
          </p>
        </div>
        <Profile config={shelfConfig} updatedAt={updatedAt} />
      </main>
      <Footer owner={shelfConfig.owner} count={0} kinds={kinds} />
    </>
  );
}
