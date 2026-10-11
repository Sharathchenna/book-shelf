import Link from "next/link";
import { AccountLink } from "./account-link";
import { Logo } from "./logo";
import { sectionLinks } from "./top-bar";

/** `shortcuts`: mention the home page's keyboard shortcuts (search, random book). */
export function Footer({ owner, count, shortcuts = false }: { owner: string; count: number; shortcuts?: boolean }) {
  return (
    <footer className="mx-auto mt-24 max-w-6xl px-4 pb-10">
      <div className="flex flex-col items-center justify-between gap-4 border-t border-line pt-8 text-sm text-muted sm:flex-row">
        <p className="flex items-center gap-2.5">
          <Logo className="size-6" />
          {owner}&apos;s Shelf · {count.toLocaleString("en-US")} books
        </p>
        <p className="text-center">
          Covers and details from{" "}
          <a
            href="https://openlibrary.org"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:text-fg hover:underline"
          >
            Open Library
          </a>
          {shortcuts && (
            <span className="hidden md:inline">
              {" "}
              · Press <kbd className="rounded border border-line px-1">/</kbd> to search,{" "}
              <kbd className="rounded border border-line px-1">R</kbd> for a random book
            </span>
          )}
        </p>
        <a href="#top" className="pill">
          Back to top ↑
        </a>
      </div>
      <nav aria-label="Sections" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted">
        {sectionLinks().map(({ section, href, label }) => (
          <Link key={section} href={href} className="underline-offset-4 hover:text-fg hover:underline">
            {label}
          </Link>
        ))}
        <AccountLink />
      </nav>
    </footer>
  );
}
