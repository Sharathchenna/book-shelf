import { after } from "next/server";
import { Suspense } from "react";
import { getClipKinds } from "@/lib/data";
import { db } from "@/lib/db";
import { shelfBooks, shelveMissing } from "@/lib/shelving";
import { shelfConfig } from "@/shelf.config";
import { Library } from "./components/bookcase/library";
import { Footer } from "./components/footer";
import { TopBar } from "./components/top-bar";
import "./components/bookcase/bookcase.css";

/** The library: every book and clipping on one bookcase, shelved by topic. */
export default function Home() {
  return (
    <Suspense fallback={<Loading />}>
      <Bookcase />
    </Suspense>
  );
}

async function Bookcase() {
  const [{ books, unsorted }, kinds] = await Promise.all([shelfBooks(), getClipKinds()]);
  // Anything not on a topic yet is sorted once the page has gone out, for the next visit.
  if (unsorted) {
    const database = await db();
    after(() => shelveMissing(database).catch((error) => console.error("Shelving failed", error)));
  }
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="library" kinds={kinds} />
      <main>
        <Library owner={shelfConfig.owner} books={books} />
      </main>
      <Footer owner={shelfConfig.owner} count={books.filter((b) => b.kind === "book").length} kinds={kinds} />
    </>
  );
}

/** While the shelf loads: the bar and the title, so the page never starts blank. */
function Loading() {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="library" kinds={[]} />
      <main className="library mx-auto w-full max-w-[1180px] px-4 sm:px-8" aria-busy>
        <section className="lib-hero">
          <h1 className="lib-title">{shelfConfig.owner}&apos;s library</h1>
        </section>
      </main>
    </>
  );
}
