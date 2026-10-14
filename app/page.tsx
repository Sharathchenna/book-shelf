import Link from "next/link";
import { after } from "next/server";
import { Suspense } from "react";
import { getClipKinds, getShelf } from "@/lib/data";
import { db } from "@/lib/db";
import { shelfBooks, shelveMissing } from "@/lib/shelving";
import { shelfConfig } from "@/shelf.config";
import { AccountLink } from "./components/account-link";
import { DailyReview } from "./components/bookcase/daily-review";
import { Library } from "./components/bookcase/library";
import { ShelfProvider } from "./components/shelf-provider";
import { sectionLinks, TopBar } from "./components/top-bar";
import "./components/bookcase/bookcase.css";

/**
 * The home page: the library, every book and clipping on one bookcase, shelved by topic, on paper
 * the way Gloss draws its own. Books open their cards here (the shelf's provider).
 */
export default function Home() {
  return (
    <div className="paper">
      <Suspense fallback={<Loading />}>
        <Shelf />
      </Suspense>
    </div>
  );
}

async function Shelf() {
  const [{ books, unsorted }, { items }, kinds] = await Promise.all([shelfBooks(), getShelf(), getClipKinds()]);
  // Anything not on a topic yet is sorted once the page has gone out, for the next visit.
  if (unsorted) {
    const database = await db();
    after(() => shelveMissing(database).catch((error) => console.error("Shelving failed", error)));
  }
  return (
    <ShelfProvider items={items}>
      <TopBar owner={shelfConfig.owner} current="library" kinds={kinds} plain />
      <main>
        <Library owner={shelfConfig.owner} books={books} aside={<DailyReview />} />
      </main>
      <footer className="lib-foot">
        <nav aria-label="Sections" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {sectionLinks(kinds).map(({ section, href, label }) => (
            <Link key={section} href={href} className="hover:text-ink">
              {label}
            </Link>
          ))}
          <span className="ml-auto">
            <AccountLink />
          </span>
        </nav>
      </footer>
    </ShelfProvider>
  );
}

/** While the shelf loads: the bar and the title, so the page never starts blank. */
function Loading() {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="library" kinds={[]} plain />
      <main className="library mx-auto w-full max-w-[1180px] px-4 sm:px-8" aria-busy>
        <section className="lib-hero">
          <h1 className="lib-title">{shelfConfig.owner}&apos;s library</h1>
        </section>
      </main>
    </>
  );
}
