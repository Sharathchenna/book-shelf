"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { textOn } from "@/lib/color";
import type { LibraryEntry } from "@/lib/library-types";
import type { Item } from "@/lib/types";
import { Logo } from "../logo";

type Upload = {
  name: string;
  progress: number;
  stage: "uploading" | "reading" | "processing" | "error";
  /** PDFs: pages read so far. */
  pages?: string;
  error?: string;
};

/**
 * Uploads one EPUB or PDF: get a URL, PUT the file there (straight to R2), then finish. The server
 * reads EPUBs itself; PDFs are read here with pdf.js and their text sent along.
 */
async function uploadBook(file: File, onProgress: (patch: Partial<Upload>) => void): Promise<void> {
  const start = await fetch("/api/books", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bytes: file.size, name: file.name }),
  });
  const started = (await start.json()) as { id?: string; format?: "epub" | "pdf"; uploadUrl?: string; contentType?: string; error?: string };
  if (!start.ok || !started.id || !started.uploadUrl) throw new Error(started.error ?? "Couldn't start the upload.");

  // XHR rather than fetch: it reports upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", started.uploadUrl!);
    xhr.setRequestHeader("content-type", started.contentType ?? "application/epub+zip");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress({ progress: e.loaded / e.total });
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
    // R2 sends its error replies without CORS headers, so any rejection looks like a network error here.
    xhr.onerror = () => reject(new Error("Storage refused the upload. Check the R2 keys and the bucket's CORS settings."));
    xhr.send(file);
  });

  if (started.format === "pdf") {
    const { finalizePdf } = await import("./pdf");
    onProgress({ stage: "reading", progress: 0 });
    await finalizePdf(started.id, await file.arrayBuffer(), {
      fileName: file.name,
      onProgress: (done, total) => onProgress({ progress: done / total, pages: `${done}/${total}` }),
    });
    return;
  }

  onProgress({ stage: "processing" });
  const done = await fetch(`/api/books/${started.id}/finalize`, { method: "POST" });
  if (!done.ok) {
    const { error } = (await done.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Couldn't read that EPUB.");
  }
}

export function LibraryView({ shelfItems }: { shelfItems: Pick<Item, "id" | "title" | "author" | "cover" | "color">[] }) {
  const [books, setBooks] = useState<LibraryEntry[] | null>(null);
  const [storage, setStorage] = useState<"r2" | "local" | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shelfById = new Map(shelfItems.map((i) => [i.id, i]));

  // Bumping the version reloads the list (after an upload or a removal).
  const [version, setVersion] = useState(0);
  const reload = () => setVersion((v) => v + 1);

  useEffect(() => {
    let current = true;
    void fetch("/api/books")
      .then((res) => (res.ok ? (res.json() as Promise<{ books: LibraryEntry[]; storage: "r2" | "local" }>) : null))
      .then((data) => {
        if (!current) return;
        setBooks(data?.books ?? []);
        setStorage(data?.storage ?? null);
      });
    return () => {
      current = false;
    };
  }, [version]);

  const add = async (files: FileList | File[]) => {
    for (const file of [...files]) {
      const update = (patch: Partial<Upload>) =>
        setUploads((list) => list.map((u) => (u.name === file.name ? { ...u, ...patch } : u)));
      setUploads((list) => [...list.filter((u) => u.name !== file.name), { name: file.name, progress: 0, stage: "uploading" }]);
      try {
        await uploadBook(file, update);
        setUploads((list) => list.filter((u) => u.name !== file.name));
        reload();
      } catch (error) {
        update({ stage: "error", error: (error as Error).message });
      }
    }
  };

  const remove = async (book: LibraryEntry) => {
    if (!confirm(`Remove “${book.title}” and its notes from your library?`)) return;
    await fetch(`/api/books/${book.id}`, { method: "DELETE" });
    reload();
  };

  const current = books?.filter((b) => b.progress && b.progress.fraction > 0.005 && b.progress.fraction < 0.995) ?? [];

  return (
    <div
      className="min-h-dvh"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        void add(e.dataTransfer.files);
      }}
    >
      <header className="sticky top-3 z-40 mx-auto max-w-6xl px-3">
        <div className="glass liquid topbar flex items-center justify-between rounded-full py-2 pr-2 pl-2.5">
          <Link href="/" className="flex items-center gap-3 rounded-full pr-2">
            <Logo className="size-9" />
            <span className="leading-tight">
              <span className="block font-serif text-[17px] leading-none">Reading room</span>
              <span className="mt-0.5 block text-xs text-muted">private · only you</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/" className="pill hidden sm:inline-flex">
              Shelf
            </Link>
            <form action="/api/logout" method="post">
              <button className="pill">Sign out</button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-14 pb-24">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="rise font-serif text-5xl sm:text-6xl">Your books</h1>
            <p className="rise mt-2 text-muted" style={{ animationDelay: "80ms" }}>
              EPUBs and PDFs you&apos;ve added. They&apos;re private to you, and your place, highlights and notes follow you between devices.
            </p>
          </div>
          <button
            onClick={() => input.current?.click()}
            className="inline-flex shrink-0 items-center gap-2 self-start rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-ink-fg transition-transform hover:scale-[1.03] active:scale-95 sm:self-auto"
          >
            <span aria-hidden>＋</span> Add EPUB or PDF
          </button>
          <input
            ref={input}
            type="file"
            accept=".epub,.pdf,application/epub+zip,application/pdf"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {storage === "local" && (
          <p className="mt-4 rounded-2xl bg-chip px-4 py-2.5 text-sm text-muted">
            Using local development storage (<code>.data/</code>). Set the R2_* variables to store books in Cloudflare R2.
          </p>
        )}

        {uploads.length > 0 && (
          <ul className="mt-6 space-y-2">
            {uploads.map((u) => (
              <li key={u.name} className="glass flex items-center gap-4 rounded-2xl px-4 py-3">
                <span className="min-w-0 flex-1 truncate text-sm">{u.name}</span>
                {u.stage === "error" ? (
                  <span className="text-sm text-red-600 dark:text-red-400">{u.error}</span>
                ) : (
                  <>
                    <span className="h-1.5 w-40 overflow-hidden rounded-full bg-chip">
                      <span
                        className={`block h-full rounded-full bg-accent transition-[width] ${u.stage === "processing" ? "animate-pulse" : ""}`}
                        style={{ width: `${Math.round(u.progress * 100)}%` }}
                      />
                    </span>
                    <span className="w-24 text-right text-xs text-muted">
                      {u.stage === "processing" ? "Reading it…" : u.stage === "reading" ? `Reading ${u.pages ?? "…"}` : `${Math.round(u.progress * 100)}%`}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {current.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xs font-medium tracking-[0.14em] text-muted uppercase">Continue reading</h2>
            <ul className="mt-4 grid gap-4 md:grid-cols-2">
              {current.slice(0, 2).map((book) => (
                <li key={book.id}>
                  <Link href={`/reader/${book.id}`} className="glass group flex items-center gap-5 rounded-3xl p-4 transition-transform hover:-translate-y-0.5">
                    <BookCover book={book} shelf={shelfById} className="w-20 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-serif text-2xl leading-tight">{book.title}</p>
                      <p className="truncate text-sm text-muted">{book.author}</p>
                      <div className="mt-3 flex items-center gap-3">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-chip">
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(book.progress!.fraction * 100)}%` }} />
                        </span>
                        <span className="text-xs text-muted tabular-nums">{Math.round(book.progress!.fraction * 100)}%</span>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        {book.sections[book.progress!.sectionIndex]?.title ?? ""}
                      </p>
                    </div>
                    <span className="hidden rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-fg transition-transform group-hover:scale-105 sm:block">
                      Resume
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-12">
          <h2 className="text-xs font-medium tracking-[0.14em] text-muted uppercase">Library</h2>
          {books === null ? (
            <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-hidden>
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i}>
                  <div className="aspect-[2/3] animate-pulse rounded-md bg-chip" />
                </li>
              ))}
            </ul>
          ) : books.length === 0 ? (
            <button
              onClick={() => input.current?.click()}
              className="mt-5 flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-line px-6 py-20 text-center transition-colors hover:border-accent/50 hover:bg-chip"
            >
              <span className="font-serif text-3xl">Drop an EPUB or PDF here</span>
              <span className="mt-2 text-muted">or click to choose one. DRM-free files only, up to 100 MB.</span>
            </button>
          ) : (
            <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {books.map((book) => {
                const p = Math.round((book.progress?.fraction ?? 0) * 100);
                const linked = book.shelfItemId ? shelfById.get(book.shelfItemId) : undefined;
                return (
                  <li key={book.id} className="group relative">
                    <Link href={`/reader/${book.id}`} className="block">
                      <div className="relative transition-transform duration-300 group-hover:-translate-y-1.5">
                        <BookCover book={book} shelf={shelfById} className="tilt" />
                        {p > 0 && (
                          <span className="glass absolute right-2 bottom-2 grid size-10 place-items-center rounded-full text-[10px] font-semibold tabular-nums">
                            <span className="ring-progress absolute inset-1 rounded-full" style={{ "--p": p } as React.CSSProperties} />
                            {p}%
                          </span>
                        )}
                      </div>
                      <p className="mt-3 line-clamp-2 text-sm leading-snug font-semibold">{book.title}</p>
                      <p className="truncate text-sm text-muted">{book.author}</p>
                    </Link>
                    <p className="mt-1 text-[11px] text-muted">
                      {book.format === "pdf"
                        ? `PDF · ${book.sections.length} pages${book.paperId ? " · paper" : ""}`
                        : linked
                          ? "On your shelf"
                          : "Not on your shelf"}
                    </p>
                    <button
                      onClick={() => void remove(book)}
                      className="absolute top-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>

      {dragging && (
        <div className="pointer-events-none fixed inset-3 z-50 grid place-items-center rounded-[32px] border-2 border-dashed border-accent bg-bg/70 backdrop-blur-sm">
          <p className="font-serif text-4xl">Drop to add to your library</p>
        </div>
      )}
    </div>
  );
}

/** The EPUB's own cover, else the matching shelf book's cover, else a generated one. */
function BookCover({
  book,
  shelf,
  className = "",
}: {
  book: LibraryEntry;
  shelf: Map<string, Pick<Item, "id" | "title" | "author" | "cover" | "color">>;
  className?: string;
}) {
  const shelfItem = book.shelfItemId ? shelf.get(book.shelfItemId) : undefined;
  const src = book.coverUrl ?? shelfItem?.cover;
  const color = shelfItem?.color ?? "#2f3a4a";
  return (
    <div
      className={`relative aspect-[2/3] overflow-hidden rounded-md shadow-[0_16px_30px_-14px_rgb(0_0_0/0.55)] ${className}`}
      style={{ background: color }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 flex flex-col justify-between p-[10%] pt-[20%]" style={{ color: textOn(color) }}>
          <p className="font-serif text-lg leading-tight">{book.title}</p>
          <p className="text-[0.6rem] font-semibold tracking-[0.14em] uppercase opacity-80">{book.author}</p>
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0/0.2),rgb(255_255_255/0.12)_4%,transparent_10%)]" />
    </div>
  );
}
