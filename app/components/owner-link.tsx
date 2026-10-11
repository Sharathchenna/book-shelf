"use client";

import Link from "next/link";
import { useShelf } from "./shelf-provider";

/** "Your books" in the top bar, shown only to the signed-in owner. */
export function OwnerLink() {
  const { owner } = useShelf();
  if (!owner) return null;
  return (
    <Link href="/reader" className="pill">
      Your books
    </Link>
  );
}
