export type Upload = {
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
export async function uploadBook(
  file: File,
  onProgress: (patch: Partial<Upload>) => void,
  /** The shelf book, or clipped paper, it belongs to. */
  owner: { shelfItemId?: string; paperId?: string } = {},
): Promise<string> {
  const { shelfItemId, paperId } = owner;
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
      shelfItemId,
      paperId,
      onProgress: (done, total) => onProgress({ progress: done / total, pages: `${done}/${total}` }),
    });
    return started.id;
  }

  onProgress({ stage: "processing" });
  const done = await fetch(`/api/books/${started.id}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ shelfItemId, paperId }),
  });
  if (!done.ok) {
    const { error } = (await done.json().catch(() => ({}))) as { error?: string };
    throw new Error(error ?? "Couldn't read that EPUB.");
  }
  return started.id;
}
