import Link from "next/link";
import { CLIP_LABEL, clipPath, inPageOrder } from "@/lib/clippings";
import type { ClipKind } from "@/lib/types";
import { AddClip } from "./add-clip";
import { Logo } from "./logo";
import { SearchPalette } from "./search-palette";
import { SyncButton } from "./sync-button";
import { ThemeToggle } from "./theme-toggle";

export type Section = "library" | "books" | ClipKind;

/**
 * The site's sections as links: the library (everything, on the home page), the books, then
 * each kind of clipping (`kinds`: the kinds that have any) on its own page.
 */
export function sectionLinks(kinds: ClipKind[]): { section: Section; href: string; label: string }[] {
  return [
    { section: "library", href: "/", label: "Library" },
    { section: "books", href: "/books", label: "Books" },
    ...inPageOrder(kinds).map((kind) => ({ section: kind, href: clipPath(kind), label: CLIP_LABEL[kind] })),
  ];
}

export function TopBar({ owner, current, kinds }: { owner: string; current: Section; kinds: ClipKind[] }) {
  return (
    <header className="sticky top-3 z-40 mx-auto max-w-6xl px-3">
      <div className="glass liquid topbar flex items-center justify-between rounded-full py-2 pr-2 pl-2.5">
        <Link href="/" className="flex items-center gap-3 rounded-full pr-2">
          <Logo className="size-9" />
          <span className="leading-tight">
            <span className="block font-serif text-[17px] leading-none">{owner}&apos;s Shelf</span>
            <span className="mt-0.5 block text-xs text-muted">reading log</span>
          </span>
        </Link>
        <nav className="flex items-center gap-2">
          {sectionLinks(kinds).map(({ section, href, label }) => (
            <Link
              key={section}
              href={href}
              aria-current={section === current ? "page" : undefined}
              className="pill hidden aria-[current=page]:bg-ink aria-[current=page]:text-ink-fg md:inline-flex"
            >
              {label}
            </Link>
          ))}
          <SearchPalette />
          <AddClip />
          <SyncButton />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
