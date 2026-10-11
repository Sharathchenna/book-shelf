"use client";

import { useEffect, useRef, useState } from "react";
import { goodreadsUrl, STATUS_LABEL } from "@/lib/shelf";
import type { Item } from "@/lib/types";
import { BookFile } from "./book-file";
import { Cover } from "./cover";
import type { Epub } from "./shelf-provider";
import { Stars } from "./stars";

type Props = {
  item: Item | null;
  prevId?: string;
  nextId?: string;
  sameAuthor: Item[];
  /** This book's EPUB or PDF, when it has one. */
  epub?: Epub;
  /** The signed-in owner reads directly and can add or remove files; visitors unlock first. */
  owner?: boolean;
  onFileChanged: () => void;
  onOpen: (id: string) => void;
  onClose: () => void;
};

export function BookDialog({ item, prevId, nextId, sameAuthor, epub, owner, onFileChanged, onOpen, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  /** Set while the page is hidden, so that closing the dialog then doesn't count as the reader closing it. */
  const hidden = useRef(false);

  // Next keeps a page mounted but hidden after navigating away (Read opens the reader from here).
  // An open modal dialog would stay in the top layer and make the next page inert, so close it
  // while hidden; the effect below opens it again when the page comes back.
  useEffect(() => {
    const dialog = ref.current;
    hidden.current = false;
    return () => {
      hidden.current = true;
      dialog?.close();
    };
  }, []);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
    // Stepping to another book keeps the dialog open but should start at its top.
    dialog.scrollTop = 0;
  }, [item]);

  // ←/→ step through the list. Listening on window, not the dialog: stepping remounts the
  // content, so focus can drop out of the dialog and its own key events would stop arriving.
  useEffect(() => {
    if (!item) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const step = { ArrowLeft: prevId, ArrowRight: nextId }[e.key];
      if (!step || e.altKey || e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      onOpen(step);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [item, prevId, nextId, onOpen]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="book-title"
      onClose={() => !hidden.current && onClose()}
      // Clicks on the dialog element itself (not its content) are clicks on the backdrop.
      onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
      className="book-dialog m-auto w-[min(58rem,calc(100%-1.5rem))] max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto rounded-[30px] border border-line bg-bg/85 p-0 text-fg shadow-[0_40px_120px_-30px_rgb(0_0_0/0.55)] backdrop-blur-2xl"
    >
      {item && (
        <BookDetails
          key={item.id}
          item={item}
          prevId={prevId}
          nextId={nextId}
          sameAuthor={sameAuthor}
          epub={epub}
          owner={owner}
          onFileChanged={onFileChanged}
          onOpen={onOpen}
        />
      )}
    </dialog>
  );
}

function BookDetails({
  item,
  prevId,
  nextId,
  sameAuthor,
  epub,
  owner = false,
  onFileChanged,
  onOpen,
}: Omit<Props, "item" | "onClose"> & { item: Item }) {
  const [copied, setCopied] = useState(false);
  const candidates = [
    STATUS_LABEL[item.status],
    item.category,
    item.year && String(item.year),
    item.pages && `${item.pages.toLocaleString("en-US")} pages`,
    item.format,
    ...item.subjects.slice(0, 4),
  ].filter(Boolean) as string[];
  // Subjects often repeat the category ("Fantasy" twice); keep the first of each.
  const tags = candidates.filter(
    (tag, i) => candidates.findIndex((t) => t.toLowerCase() === tag.toLowerCase()) === i,
  );

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="relative">
      {/* A glow in the cover's colour ties the dialog to the book. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-40 size-[34rem] rounded-full opacity-40 blur-3xl"
        style={{ background: item.color }}
      />

      <div className="absolute top-4 right-4 z-10 flex gap-1.5">
        <IconButton label="Previous book" disabled={!prevId} onClick={() => prevId && onOpen(prevId)}>
          <path d="M15 6l-6 6 6 6" />
        </IconButton>
        <IconButton label="Next book" disabled={!nextId} onClick={() => nextId && onOpen(nextId)}>
          <path d="M9 6l6 6-6 6" />
        </IconButton>
        <form method="dialog">
          <IconButton label="Close">
            <path d="M6 6l12 12M18 6 6 18" />
          </IconButton>
        </form>
      </div>

      <div className="relative grid gap-6 p-5 pt-16 sm:grid-cols-[14rem_1fr] sm:gap-9 sm:p-8">
        <Cover item={item} tilt className="rise mx-auto w-44 sm:w-full" />

        <div className="min-w-0">
          <h2 id="book-title" className="rise font-serif text-4xl leading-[1.05] sm:pr-24 sm:text-5xl" style={stagger(0)}>
            {item.title}
          </h2>
          <p className="rise mt-2 text-muted" style={stagger(1)}>
            {item.author}
            {item.series && ` · ${item.series}`}
          </p>

          <ul className="mt-5 flex flex-wrap gap-1.5">
            {tags.map((tag, i) => (
              <li
                key={tag}
                style={stagger(2 + i * 0.4)}
                className={`rise rounded-full px-3 py-1 text-xs font-medium ${
                  i === 0 && item.status === "reading" ? "bg-accent text-white" : "bg-chip"
                }`}
              >
                {tag}
              </li>
            ))}
          </ul>

          <Stars rating={item.rating} pop className="mt-4 block text-lg" />

          {item.description && (
            <p className="rise mt-4 text-[15px] leading-relaxed text-muted" style={stagger(4)}>
              {item.description}
            </p>
          )}

          {item.review && (
            <blockquote className="rise mt-5 border-l-2 border-accent pl-4 font-serif text-xl leading-snug italic" style={stagger(5)}>
              {item.review}
            </blockquote>
          )}

          <div className="rise mt-6 flex flex-wrap gap-2" style={stagger(6)}>
            <BookFile shelfItemId={item.id} epub={epub} owner={owner} onChanged={onFileChanged} />
            <a className="pill" href={goodreadsUrl(item)} target="_blank" rel="noreferrer">
              Goodreads ↗
            </a>
            {item.openLibraryKey && (
              <a
                className="pill"
                href={`https://openlibrary.org${item.openLibraryKey}`}
                target="_blank"
                rel="noreferrer"
              >
                Open Library ↗
              </a>
            )}
            <button className="pill" onClick={copyLink}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      </div>

      {sameAuthor.length > 0 && (
        <section className="relative border-t border-line px-5 py-5 sm:px-8">
          <h3 className="text-xs font-medium tracking-[0.14em] text-muted uppercase">More by {item.author}</h3>
          <ul className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {sameAuthor.map((other) => (
              <li key={other.id} className="w-20 shrink-0">
                <button onClick={() => onOpen(other.id)} className="group w-full text-left" title={other.title}>
                  <Cover item={other} className="transition-transform group-hover:-translate-y-1" />
                  <span className="mt-1.5 line-clamp-2 text-xs leading-tight">{other.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Staggered entrance for the details, after the book has started to arrive. */
const stagger = (step: number) => ({ animationDelay: `${0.18 + step * 0.06}s` });

function IconButton({
  label,
  children,
  ...props
}: { label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      title={label}
      className="grid size-9 place-items-center rounded-full bg-chip backdrop-blur transition-colors hover:bg-line disabled:opacity-30 disabled:hover:bg-chip"
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        className="size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {children}
      </svg>
    </button>
  );
}
