import Link from "next/link";
import { AccountLink } from "./account-link";
import { Logo } from "./logo";
import type { ClipKind } from "@/lib/types";
import { sectionLinks } from "./top-bar";

export function Footer({
  owner,
  count,
  kinds,
}: {
  owner: string;
  count: number;
  /** Kinds of clipping that have any, for the section links. */
  kinds: ClipKind[];
}) {
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
        </p>
        <a href="#top" className="pill">
          Back to top ↑
        </a>
      </div>
      <nav aria-label="Sections" className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-muted">
        {sectionLinks(kinds).map(({ section, href, label }) => (
          <Link key={section} href={href} className="underline-offset-4 hover:text-fg hover:underline">
            {label}
          </Link>
        ))}
        <AccountLink />
      </nav>
    </footer>
  );
}
