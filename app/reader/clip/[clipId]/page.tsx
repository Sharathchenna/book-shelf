import type { Metadata } from "next";
import { Suspense } from "react";
import { ClipOpener } from "../../../components/reader/clip-opener";
import { OwnerGate } from "../../owner-gate";

export const metadata: Metadata = { title: "Opening article", robots: { index: false } };

/** "Read" on a clipped X Article: made into an ebook the first time, then opened in the reader. */
export default function OpenClipPage({ params }: PageProps<"/reader/clip/[clipId]">) {
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <Gate params={params} />
    </Suspense>
  );
}

async function Gate({ params }: { params: PageProps<"/reader/clip/[clipId]">["params"] }) {
  const { clipId } = await params;
  return (
    <OwnerGate next={`/reader/clip/${clipId}`}>
      <ClipOpener clipId={clipId} />
    </OwnerGate>
  );
}
