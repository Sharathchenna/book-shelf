import type { Metadata } from "next";
import { shelf } from "@/lib/shelf";
import { shelfConfig } from "@/shelf.config";
import { LibraryView } from "../components/reader/library-view";

export const metadata: Metadata = { title: "Reading room" };

// Only what the library cards need from the shelf, to keep the page payload small.
const shelfItems = shelf.items.map(({ id, title, author, cover, color }) => ({ id, title, author, cover, color }));

/**
 * The library, on show to everyone. Visitors see the books locked and can unlock them with the
 * password; the owner can also add, remove and resume. Opening a book is checked server-side.
 */
export default function ReaderLibraryPage() {
  return <LibraryView shelfItems={shelfItems} ownerName={shelfConfig.owner} />;
}
