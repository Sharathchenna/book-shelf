"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useOptionalShelf } from "./shelf-provider";

/** "Your books" in the top bar, shown only to the signed-in owner. */
export function OwnerLink() {
  const shelf = useOptionalShelf();
  // Outside the home page there's no shelf provider to ask, so check the session directly.
  const [standaloneOwner, setStandaloneOwner] = useState(false);
  useEffect(() => {
    if (shelf) return;
    let current = true;
    void fetch("/api/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((me: { owner: boolean } | null) => current && setStandaloneOwner(Boolean(me?.owner)))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [shelf]);

  if (!(shelf ? shelf.owner : standaloneOwner)) return null;
  return (
    <Link href="/reader" className="pill">
      Your books
    </Link>
  );
}
