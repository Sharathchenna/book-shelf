import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getClipKinds, getClippings } from "@/lib/data";
import { refreshPaperCode } from "@/lib/save";
import { shelfConfig } from "@/shelf.config";
import { PaperDiscover } from "../../components/papers/discover";
import { TopBar } from "../../components/top-bar";
import { OwnerGate } from "../../reader/owner-gate";

export const metadata: Metadata = { title: `Discover papers · ${shelfConfig.owner}'s Shelf`, robots: { index: false } };

/** Papers saved without Papers with Code's details get them here, a few at a time, so "For you" knows their tasks. */
const FILL_ON_VISIT = 12;

/** New papers to read, from Papers with Code. Owner only: saving and reading are theirs. */
export default function DiscoverPage() {
  return (
    <Suspense fallback={<Frame />}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  return (
    <OwnerGate next="/papers/discover">
      <Content />
    </OwnerGate>
  );
}

async function Content() {
  await refreshPaperCode(FILL_ON_VISIT, { missingOnly: true }).catch((error) => console.error("Papers with Code refresh failed", error));
  const [{ items }, kinds] = await Promise.all([getClippings("paper"), getClipKinds()]);
  // The tasks of the papers already saved, most frequent first: what "For you" looks in.
  const tally = new Map<string, { name: string; slug: string; n: number }>();
  for (const clip of items) {
    for (const task of clip.paper?.pwc?.tasks ?? []) {
      const seen = tally.get(task.slug) ?? { ...task, n: 0 };
      seen.n++;
      tally.set(task.slug, seen);
    }
  }
  const ownTasks = [...tally.values()].sort((a, b) => b.n - a.n).map(({ name, slug }) => ({ name, slug }));
  return (
    <Frame kinds={kinds}>
      <PaperDiscover saved={items.map((clip) => clip.id)} ownTasks={ownTasks} />
    </Frame>
  );
}

function Frame({ kinds = [], children }: { kinds?: Awaited<ReturnType<typeof getClipKinds>>; children?: React.ReactNode }) {
  return (
    <>
      <TopBar owner={shelfConfig.owner} current="paper" kinds={kinds} />
      <main className="mx-auto max-w-6xl px-4 pt-14 pb-20">
        <Link href="/papers" className="text-sm text-muted hover:text-fg">
          ← Your papers
        </Link>
        <h1 className="mt-3 font-serif text-5xl leading-none sm:text-6xl">Discover</h1>
        <p className="mt-3 max-w-xl text-muted">
          New research with code: what&apos;s trending, what&apos;s new in the areas you read, and where each paper stands on its benchmarks.
        </p>
        <div className="mt-10">{children ?? <div className="h-64 animate-pulse rounded-3xl bg-chip" aria-hidden />}</div>
      </main>
    </>
  );
}
