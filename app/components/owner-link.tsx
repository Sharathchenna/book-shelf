"use client";

import Link from "next/link";
import { useOptionalShelf } from "./shelf-provider";
import { useIsOwner } from "./use-owner";

/** "Your books" in the top bar, shown only to the signed-in owner. */
export function OwnerLink() {
  const shelf = useOptionalShelf();
  // Outside the home page there's no shelf provider to ask, so check the session directly.
  const standaloneOwner = useIsOwner(Boolean(shelf));
  if (!(shelf ? shelf.owner : standaloneOwner)) return null;
  return (
    <Link href="/reader" className="pill">
      Your books
    </Link>
  );
}
