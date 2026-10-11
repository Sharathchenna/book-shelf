"use client";

import Link from "next/link";
import { useOptionalShelf } from "./shelf-provider";
import { useMe } from "./use-owner";

/**
 * The reading room in the top bar: "Your books" for the signed-in owner, "Reading room" for
 * visitors once there's something in it (the books are on show, locked).
 */
export function OwnerLink() {
  const shelf = useOptionalShelf();
  // Outside the home page there's no shelf provider to ask, so check directly.
  const standalone = useMe(Boolean(shelf));
  const me = shelf?.library ? { owner: shelf.library.owner, books: shelf.library.size } : standalone;
  if (!me || (!me.owner && me.books === 0)) return null;
  return (
    <Link href="/reader" className="pill">
      {me.owner ? "Your books" : "Reading room"}
    </Link>
  );
}
