import type { Metadata } from "next";
import { Suspense } from "react";
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
      <ReaderView id={id} />
    </OwnerGate>
  );
}
