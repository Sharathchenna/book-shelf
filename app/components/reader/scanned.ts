import { toBase64Jpeg, type PDFDocumentProxy } from "./pdf";

/**
 * Scanned PDF pages, read by Claude Haiku: pages whose text layer is empty are rendered here,
 * read by /api/books/[id]/ocr, and their text saved with /text a few pages at a time, so the
 * reader's AI (Recap, Chat, Brief, Explain's context) can read them too.
 */

/** A page with less text than this has no real text layer. Matches EMPTY_BELOW in the text route. */
export const SCANNED_BELOW = 20;
/** Haiku's cost to read one page, about: a 1,400 px page is ~1,600 tokens in, ~500 out. */
export const COST_PER_PAGE = 0.0004;
const AT_ONCE = 3;
const WIDTH = 1400;

export const scannedPages = (sections: { chars: number }[]) => sections.flatMap((s, i) => (s.chars < SCANNED_BELOW ? [i] : []));

async function pageJpeg(doc: PDFDocumentProxy, n: number): Promise<string> {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: WIDTH / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return toBase64Jpeg(canvas, 0.8);
}

/** Reads `pages` (0-based), a few at a time, and saves what each says. Stops when `signal` aborts. */
export async function readScannedPages(
  doc: PDFDocumentProxy,
  bookId: string,
  pages: number[],
  onProgress: (done: number) => void,
  signal: AbortSignal,
): Promise<number> {
  let next = 0;
  let done = 0;
  let pending: { page: number; text: string }[] = [];
  // One save at a time, so the text file isn't written twice at once.
  let saving = Promise.resolve();
  const save = (batch: typeof pending) =>
    (saving = saving.then(async () => {
      if (!batch.length) return;
      await fetch(`/api/books/${bookId}/text`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ pages: batch }) });
    }));

  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let i = next++; i < pages.length && !signal.aborted; i = next++) {
        const page = pages[i];
        const image = await pageJpeg(doc, page + 1);
        const res = await fetch(`/api/books/${bookId}/ocr`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image }),
          signal,
        }).catch(() => null);
        const { text } = ((await res?.json().catch(() => ({}))) ?? {}) as { text?: string };
        if (text?.trim()) pending.push({ page, text });
        onProgress(++done);
        if (pending.length >= 10) {
          void save(pending);
          pending = [];
        }
      }
    }),
  );
  await save(pending);
  await saving;
  return done;
}
