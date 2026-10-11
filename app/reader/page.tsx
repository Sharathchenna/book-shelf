import type { Metadata } from "next";
import { Suspense } from "react";
import { shelf } from "@/lib/shelf";
import { LibraryView } from "../components/reader/library-view";
import { OwnerGate } from "./owner-gate";

export const metadata: Metadata = { title: "Your books", robots: { index: false } };

// Only what the library cards need from the shelf, to keep the page payload small.
const shelfItems = shelf.items.map(({ id, title, author, cover, color }) => ({ id, title, author, cover, color }));

export default function ReaderLibraryPage() {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <OwnerGate next="/reader">
        <LibraryView shelfItems={shelfItems} />
      </OwnerGate>
    </Suspense>
  );
}
