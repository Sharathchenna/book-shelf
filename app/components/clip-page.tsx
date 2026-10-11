import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CLIP_LABEL } from "@/lib/clippings";
import { getBookCount, getClipKinds, getClippings } from "@/lib/data";
import type { ClipKind } from "@/lib/types";
import { shelfConfig } from "@/shelf.config";
import { ClipGrid } from "./clippings";
import { Footer } from "./footer";
import { sectionLinks, TopBar } from "./top-bar";

const BLURB: Record<ClipKind, string> = {
  article: "Essays and long reads from around the web, with notes in the margins.",
  paper: "Research worth the close read: abstracts, authors and where each one appeared.",
  newsletter: "Issues worth keeping from the newsletters in the inbox.",
  tweet: "Posts that stuck, kept here in case they disappear.",
};

export function clipMetadata(kind: ClipKind): Metadata {
  const title = `${CLIP_LABEL[kind]} · ${shelfConfig.owner}'s Shelf`;
  const description = BLURB[kind];
  return { title, description, openGraph: { title, description }, twitter: { title, description } };
}

/**
 * One kind of clipping (articles, papers, newsletters or tweets) on its own page. The heading
 * ships with the page; the clippings come from the database as the request arrives.
 */
export function ClipPage({ kind }: { kind: ClipKind }) {
  return (
    <Suspense fallback={<ClipPageFrame kind={kind} kinds={[]} />}>
      <ClipPageContent kind={kind} />
    </Suspense>
  );
}

async function ClipPageContent({ kind }: { kind: ClipKind }) {
  const [{ items }, kinds, books] = await Promise.all([getClippings(kind), getClipKinds(), getBookCount()]);
  return (
    <ClipPageFrame
      kind={kind}
      kinds={kinds}
      count={items.length}
      footer={<Footer owner={shelfConfig.owner} count={books} kinds={kinds} />}
    >
      {items.length ? (
        <ClipGrid kind={kind} items={items} />
      ) : (
        <p className="rounded-3xl border border-dashed border-line px-6 py-16 text-center text-muted">
          Nothing here yet.
        </p>
      )}
    </ClipPageFrame>
  );
}

function ClipPageFrame({
  kind,
  kinds,
  count,
  children,
  footer,
}: {
  kind: ClipKind;
  kinds: ClipKind[];
  count?: number;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current={kind} kinds={kinds} />
      <main className="mx-auto max-w-6xl px-4 pt-14">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="font-serif text-5xl leading-none sm:text-6xl">
              {CLIP_LABEL[kind]}
              {count !== undefined && <span className="ml-3 align-middle font-sans text-base text-muted">{count}</span>}
            </h1>
            <p className="mt-3 max-w-xl text-muted">{BLURB[kind]}</p>
          </div>
          {/* Section switcher; the top bar hides its links on small screens. */}
          {kinds.length > 0 && (
            <nav aria-label="Sections" className="flex max-w-full self-start overflow-x-auto rounded-full bg-chip p-1 [scrollbar-width:none] md:hidden">
              {sectionLinks(kinds).map(({ section, href, label }) => (
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
          )}
        </div>
        <div className="mt-10">{children ?? <div className="h-64 animate-pulse rounded-3xl bg-chip" aria-hidden />}</div>
      </main>
      {footer}
    </>
  );
}
