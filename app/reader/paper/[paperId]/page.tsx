import type { Metadata } from "next";
import { Suspense } from "react";
import { PaperOpener } from "../../../components/reader/paper-opener";
import { OwnerGate } from "../../owner-gate";

export const metadata: Metadata = { title: "Opening paper", robots: { index: false } };

/** "Read" on a clipped paper: adds its PDF to the library the first time, then opens it. */
export default function OpenPaperPage({ params }: PageProps<"/reader/paper/[paperId]">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: PageProps<"/reader/paper/[paperId]">["params"] }) {
  const { paperId } = await params;
  return (
    <OwnerGate next={`/reader/paper/${paperId}`}>
      <PaperOpener paperId={paperId} />
    </OwnerGate>
  );
}
