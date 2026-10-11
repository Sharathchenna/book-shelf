"use client";

import Link from "next/link";
import { useMe } from "./use-owner";

/** The owner's way in and out, kept quiet in the footer: books are added and read from their cards. */
export function AccountLink() {
  const me = useMe();
  if (!me) return null;
  return me.owner ? (
    <form action="/api/logout" method="post" className="contents">
      <button className="underline-offset-4 hover:text-fg hover:underline">Sign out</button>
    </form>
  ) : (
    <Link href="/login?next=/" className="underline-offset-4 hover:text-fg hover:underline">
      Sign in
    </Link>
  );
}
