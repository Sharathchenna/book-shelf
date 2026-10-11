import { CLIP_LABEL } from "@/lib/clippings";
import type { ClipKind } from "@/lib/types";
import { Logo } from "./logo";
import { OwnerLink } from "./owner-link";
import { ThemeToggle } from "./theme-toggle";

export function TopBar({ owner, clipKinds }: { owner: string; clipKinds: ClipKind[] }) {
  return (
    <header className="sticky top-3 z-40 mx-auto max-w-6xl px-3">
      <div className="glass liquid topbar flex items-center justify-between rounded-full py-2 pr-2 pl-2.5">
        <a href="#top" className="flex items-center gap-3 rounded-full pr-2">
          <Logo className="size-9" />
          <span className="leading-tight">
            <span className="block font-serif text-[17px] leading-none">{owner}&apos;s Shelf</span>
            <span className="mt-0.5 block text-xs text-muted">reading log</span>
          </span>
        </a>
        <nav className="flex items-center gap-2">
          <a href="#about" className="pill hidden sm:inline-flex">
            About
          </a>
          <a href="#insights" className="pill hidden sm:inline-flex">
            Insights
          </a>
          {clipKinds.map((kind) => (
            <a key={kind} href={`#${CLIP_LABEL[kind].toLowerCase()}`} className="pill hidden lg:inline-flex">
              {CLIP_LABEL[kind]}
            </a>
          ))}
          <a href="#library" className="pill hidden sm:inline-flex">
            Library
          </a>
          <OwnerLink />
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
