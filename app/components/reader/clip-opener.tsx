"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ARTICLE_EPUB_BUILD } from "@/lib/library-types";
import { OpeningBook } from "./chrome";

type Opened = { id?: string; ready?: boolean; build?: "epub"; replaces?: string[]; error?: string };

/**
 * Gets a clipped article (an X Article, or any other) into the library and opens it: the first
 * time, the article is fetched and made into an ebook here (x-article-epub.ts) and saved like an
 * upload. After that it opens at once.
 */
export function ClipOpener({ clipId }: { clipId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Finding the article…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const show = (text: string) => !cancelled && setLabel(text);
    (async () => {
      const res = await fetch("/api/books/clips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clipId }),
      });
      const data = (await res.json().catch(() => ({}))) as Opened;
      if (!res.ok) throw new Error(data.error ?? "Couldn't add this article.");
      if (data.ready && data.id) {
        if (!cancelled) router.replace(`/reader/${data.id}`);
        return;
      }
      const { buildArticleEpub } = await import("./x-article-epub");
      const epub = await buildArticleEpub(clipId, show);
      const { uploadBook } = await import("./upload");
      const id = await uploadBook(
        new File([epub], `${clipId}.epub`, { type: "application/epub+zip" }),
        (patch) => show(patch.stage === "uploading" ? `Saving to your library… ${Math.round((patch.progress ?? 0) * 100)}%` : "Reading it…"),
        { clipId, build: ARTICLE_EPUB_BUILD },
      );
      // A copy made by an older conversion hands its highlights and place to the new one, then goes.
      // If the handing over fails the old copy stays, so nothing's lost.
      show("Bringing your highlights across…");
      for (const old of data.replaces ?? []) {
        const adopted = await fetch(`/api/books/${id}/adopt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ from: old }) }).catch(() => null);
        if (adopted?.ok) await fetch(`/api/books/${old}`, { method: "DELETE" }).catch(() => {});
      }
      if (!cancelled) router.replace(`/reader/${id}`);
    })().catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [clipId, router]);

  if (error) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-bg p-6 text-center">
        <div>
          <p className="font-serif text-3xl">This article wouldn&apos;t open.</p>
          <p className="mt-2 text-muted">{error}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href="/articles" className="pill">
              Back to articles
            </Link>
            <Link href="/" className="pill">
              The shelf
            </Link>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="fixed inset-0 bg-bg">
      <OpeningBook label={label} />
    </div>
  );
}
