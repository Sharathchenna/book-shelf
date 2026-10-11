"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { LoginForm } from "../login/login-form";
import type { Upload } from "./reader/upload";
import type { Epub } from "./shelf-provider";

const BOOK_ICON = "M12 7c-2-1.5-5-2-8-1.5v12c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-12c-3-.5-6 0-8 1.5zM12 7v12";
const LOCK_ICON = "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z";

/**
 * A book's own file, on its card. Visitors see Read, locked: it asks for the password, then opens
 * the book. The signed-in owner reads straight away, adds an EPUB or PDF to a book that has none,
 * or removes one.
 */
export function BookFile({
  shelfItemId,
  epub,
  owner,
  onChanged,
}: {
  shelfItemId: string;
  epub?: Epub;
  owner: boolean;
  /** After an upload or removal, so the shelf learns what changed. */
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [upload, setUpload] = useState<Partial<Upload> | null>(null);

  const add = async (file: File) => {
    setUpload({ stage: "uploading", progress: 0 });
    try {
      const { uploadBook } = await import("./reader/upload");
      await uploadBook(file, (patch) => setUpload((u) => ({ ...u, ...patch })), shelfItemId);
      setUpload(null);
      onChanged();
    } catch (error) {
      setUpload({ stage: "error", error: (error as Error).message });
    }
  };

  const remove = async () => {
    if (!epub || !confirm("Remove this book's file, with your place, highlights and notes?")) return;
    await fetch(`/api/books/${epub.id}`, { method: "DELETE" });
    onChanged();
  };

  if (!epub && !owner) return null;

  if (!epub) {
    const busy = upload && upload.stage !== "error";
    return (
      <>
        <button onClick={() => input.current?.click()} disabled={Boolean(busy)} className="pill disabled:opacity-70">
          <Icon d="M12 16V4M7 9l5-5 5 5M5 20h14" />
          {upload?.stage === "uploading"
            ? `Uploading ${Math.round((upload.progress ?? 0) * 100)}%`
            : upload?.stage === "reading"
              ? `Reading pages ${upload.pages ?? ""}`
              : upload?.stage === "processing"
                ? "Reading it…"
                : "Add EPUB or PDF"}
        </button>
        <input
          ref={input}
          type="file"
          accept=".epub,.pdf,application/epub+zip,application/pdf"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void add(file);
            e.target.value = "";
          }}
        />
        {upload?.stage === "error" && (
          <p role="alert" className="basis-full text-sm text-red-600 dark:text-red-400">
            {upload.error}
          </p>
        )}
      </>
    );
  }

  const read = `/reader/${epub.id}`;
  return (
    <>
      {owner ? (
        <Link href={read} className={PRIMARY}>
          <Icon d={BOOK_ICON} />
          {epub.fraction > 0.005 ? `Continue · ${Math.round(epub.fraction * 100)}%` : "Read"}
        </Link>
      ) : (
        <button onClick={() => setUnlocking((u) => !u)} aria-expanded={unlocking} className={PRIMARY}>
          <Icon d={LOCK_ICON} />
          Read · locked
        </button>
      )}
      {owner && (
        <button onClick={() => void remove()} className="pill text-muted">
          Remove file
        </button>
      )}
      {unlocking && (
        <div className="basis-full rounded-2xl bg-chip/60 px-4 pb-4 sm:max-w-sm [&>form]:mt-3 [&>form]:pt-1">
          <LoginForm next={read} submitLabel="Open" />
        </div>
      )}
    </>
  );
}

const PRIMARY =
  "inline-flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-ink-fg transition-transform hover:scale-[1.03]";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}
