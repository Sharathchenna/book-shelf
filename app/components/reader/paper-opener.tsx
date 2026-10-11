"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OpeningBook } from "./chrome";

/**
 * Gets a clipped paper into the library (the server fetches its PDF; this page reads the pages,
 * as after an upload) and then opens it. Already-added papers open straight away.
 */
export function PaperOpener({ paperId }: { paperId: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Finding the paper…");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/books/papers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paperId }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; ready?: boolean; fileUrl?: string; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Couldn't add this paper.");

      if (!data.ready && data.fileUrl) {
        setLabel("Downloading the PDF…");
        const file = await fetch(data.fileUrl).then((r) => {
          if (!r.ok) throw new Error("Couldn't download the PDF.");
          return r.arrayBuffer();
        });
        const { finalizePdf } = await import("./pdf");
        await finalizePdf(data.id, file, {
          paperId,
          onProgress: (done, total) => !cancelled && setLabel(`Reading page ${done} of ${total}…`),
        });
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
