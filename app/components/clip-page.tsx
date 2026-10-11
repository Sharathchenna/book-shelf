import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CLIP_LABEL, clippings } from "@/lib/clippings";
import { shelf } from "@/lib/shelf";
import type { Clip, ClipKind } from "@/lib/types";
import { shelfConfig } from "@/shelf.config";
import { ClipGrid } from "./clippings";
import { Footer } from "./footer";
import { sectionLinks, TopBar } from "./top-bar";

const BLURB: Record<ClipKind, (items: Clip[]) => string> = {
  article: () => "Essays and long reads from around the web, with notes in the margins.",
  newsletter: (items) => {
    const publications = new Set(items.map((c) => c.source)).size;
    return `Issues worth keeping from ${publications} ${publications === 1 ? "publication" : "publications"} in the inbox.`;
  },
  tweet: () => "Posts that stuck, kept here in case they disappear.",
};

const itemsOf = (kind: ClipKind) => clippings.items.filter((c) => c.kind === kind);

export function clipMetadata(kind: ClipKind): Metadata {
  const title = `${CLIP_LABEL[kind]} · ${shelfConfig.owner}'s Shelf`;
  const description = BLURB[kind](itemsOf(kind));
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

/** One kind of clipping (articles, newsletters or tweets) on its own page. */
export function ClipPage({ kind }: { kind: ClipKind }) {
  const items = itemsOf(kind);
  if (items.length === 0) notFound();

  return (
    <>
      <TopBar owner={shelfConfig.owner} current={kind} />
      <main className="mx-auto max-w-6xl px-4 pt-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-serif text-5xl leading-none sm:text-6xl">
              {CLIP_LABEL[kind]}
              <span className="ml-3 align-middle font-sans text-base text-muted">{items.length}</span>
            </h1>
            <p className="mt-3 max-w-xl text-muted">{BLURB[kind](items)}</p>
          </div>
          {/* Section switcher; the top bar hides its links on small screens. */}
          <nav aria-label="Sections" className="flex max-w-full self-start overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none] md:hidden">
            {sectionLinks().map(({ section, href, label }) => (
              <Link
                key={section}
                href={href}
                aria-current={section === kind ? "page" : undefined}
                className="shrink-0 rounded-full px-4 py-1.5 text-sm font-medium text-muted transition-all hover:text-fg aria-[current=page]:bg-bg aria-[current=page]:text-fg aria-[current=page]:shadow-sm"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-10">
          <ClipGrid kind={kind} items={items} />
        </div>
      </main>
      <Footer owner={shelfConfig.owner} count={shelf.items.length} />
    </>
  );
}
