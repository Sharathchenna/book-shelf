"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ARXIV_EPUB_BUILD } from "@/lib/library-types";
import { OpeningBook } from "./chrome";

type Opened = {
  id?: string;
  ready?: boolean;
  fileUrl?: string;
  build?: "epub";
  arxiv?: string;
  title?: string;
  authors?: string[];
  replaces?: string[];
  error?: string;
};

/**
 * Gets a clipped paper into the library and opens it. An arXiv paper becomes an ebook, built here
 * from arXiv's HTML version (reflowing text, real equations, figures); without one, or for other
 * papers, the server fetches the PDF and this page reads its pages. Papers already added open at once.
 */
export function PaperOpener({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Finding the paper…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const ask = async (format?: "pdf") => {
      const res = await fetch("/api/books/papers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId, format }),
      });
      const data = (await res.json().catch(() => ({}))) as Opened;
      if (!res.ok) throw new Error(data.error ?? "Couldn't add this paper.");
      return data;
    };
    const show = (text: string) => !cancelled && setLabel(text);

    (async () => {
      let data = await ask();

      if (data.build === "epub" && data.arxiv) {
        const { buildArxivEpub } = await import("./arxiv-epub");
        const epub = await buildArxivEpub(
          { paperId, arxiv: data.arxiv, title: data.title ?? data.arxiv, authors: data.authors ?? [] },
          show,
        ).catch(() => null);
        if (epub) {
          const { uploadBook } = await import("./upload");
          const id = await uploadBook(
            new File([epub], `${data.arxiv}.epub`, { type: "application/epub+zip" }),
            (patch) => show(patch.stage === "uploading" ? `Saving to your library… ${Math.round((patch.progress ?? 0) * 100)}%` : "Reading it…"),
            { paperId, build: ARXIV_EPUB_BUILD },
          );
          // A PDF copy added before this paper could be read as an ebook is no longer needed.
          await Promise.all((data.replaces ?? []).map((old) => fetch(`/api/books/${old}`, { method: "DELETE" }).catch(() => {})));
          if (!cancelled) router.replace(`/reader/${id}`);
          return;
        }
        show("No ebook version; opening the PDF…");
        data = await ask("pdf");
      }

      if (!data.id) throw new Error("Couldn't add this paper.");
      if (!data.ready && data.fileUrl) {
        show("Downloading the PDF…");
        const file = await fetch(data.fileUrl).then((r) => {
          if (!r.ok) throw new Error("Couldn't download the PDF.");
          return r.arrayBuffer();
        });
        const { finalizePdf } = await import("./pdf");
        await finalizePdf(data.id, file, { paperId, onProgress: (done, total) => show(`Reading page ${done} of ${total}…`) });
      }
      if (!cancelled) router.replace(`/reader/${data.id}`);
    })().catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, [paperId, router]);

  if (error) {
    return (
      <div className="fixed inset-0 grid place-items-center bg-bg p-6 text-center">
        <div>
          <p className="font-serif text-3xl">This paper wouldn&apos;t open.</p>
          <p className="mt-2 text-muted">{error}</p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href="/papers" className="pill">
              Back to papers
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
