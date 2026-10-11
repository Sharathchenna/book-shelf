import type { Metadata } from "next";
import { Suspense } from "react";
import { getFile } from "@/lib/library";
import { PdfReaderView } from "../../components/reader/pdf-reader-view";
import { ReaderView } from "../../components/reader/reader-view";
import { OwnerGate } from "../owner-gate";

export const metadata: Metadata = { title: "Reading", robots: { index: false } };

export default function ReaderPage({ params }: PageProps<"/reader/[id]">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <Reader params={params} />
    </Suspense>
  );
}

async function Reader({ params }: { params: PageProps<"/reader/[id]">["params"] }) {
  const { id } = await params;
  return (
    <OwnerGate next={`/reader/${id}`}>
      <BookView id={id} />
    </OwnerGate>
  );
}

/** EPUBs open in the reflowing reader; PDFs keep their pages. Unknown ids get the reader's own error. */
async function BookView({ id }: { id: string }) {
  const book = await getFile(id);
  return book?.format === "pdf" ? <PdfReaderView id={id} /> : <ReaderView id={id} />;
}
