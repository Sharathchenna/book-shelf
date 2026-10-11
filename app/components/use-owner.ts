"use client";

import { useEffect, useState } from "react";

export type Me = { owner: boolean; books: number };

let inFlight: Promise<Me | null> | undefined;

/**
 * Who is looking at this (static, public) page, and how many books are in the reading room.
 * Components on the same page share one /api/me request. Pass `skip` when the answer is already
 * known some other way.
 */
export function useMe(skip = false): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    if (skip) return;
    let current = true;
    inFlight ??= fetch("/api/me")
      .then((res) => (res.ok ? (res.json() as Promise<{ owner: boolean; library?: unknown[] }>) : null))
      .then((data) => (data ? { owner: data.owner, books: data.library?.length ?? 0 } : null))
      .catch(() => null)
      .finally(() => setTimeout(() => (inFlight = undefined)));
    void inFlight.then((value) => current && setMe(value));
    return () => {
      current = false;
    };
  }, [skip]);
  return me;
}

export const useIsOwner = (skip = false) => useMe(skip)?.owner ?? false;
