"use client";

import { useEffect, useState } from "react";

let inFlight: Promise<boolean> | undefined;

/**
 * Whether the signed-in owner is looking at this (static, public) page. Components on the same
 * page share one /api/me request. Pass `skip` when the answer is already known some other way.
 */
export function useIsOwner(skip = false): boolean {
  const [owner, setOwner] = useState(false);
  useEffect(() => {
    if (skip) return;
    let current = true;
    inFlight ??= fetch("/api/me")
      .then((res) => (res.ok ? (res.json() as Promise<{ owner: boolean }>) : null))
      .then((me) => Boolean(me?.owner))
      .catch(() => false)
      .finally(() => setTimeout(() => (inFlight = undefined)));
    void inFlight.then((o) => current && setOwner(o));
    return () => {
      current = false;
    };
  }, [skip]);
  return owner;
}
