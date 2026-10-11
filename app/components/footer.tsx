import { Logo } from "./logo";

export function Footer({ owner, count }: { owner: string; count: number }) {
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
          <span className="hidden md:inline">
            {" "}
            · Press <kbd className="rounded border border-line px-1">/</kbd> to search,{" "}
            <kbd className="rounded border border-line px-1">R</kbd> for a random book
          </span>
        </p>
        <a href="#top" className="pill">
          Back to top ↑
        </a>
      </div>
    </footer>
  );
}
