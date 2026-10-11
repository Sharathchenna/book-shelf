"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ownerConfigured, passwordMatches, startSession } from "@/lib/auth/session";

export type LoginState = { error?: string };

// Slows down guessing; the password check itself is constant-time.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrong guesses per address. Kept in memory, so it's per Worker instance: a speed bump on top of
 * the delay, not a guarantee. A long password is the real protection.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const failures = new Map<string, number[]>();

export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  if (!ownerConfigured()) return { error: "Owner login isn't set up on this server (OWNER_PASSWORD, SESSION_SECRET)." };

  const h = await headers();
  const ip = h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILURES) return { error: "Too many wrong tries. Wait a few minutes and try again." };

  const password = String(form.get("password") ?? "");
  if (!passwordMatches(password)) {
    failures.set(ip, [...recent, now]);
    if (failures.size > 5000) failures.delete(failures.keys().next().value!);
    await delay(600 + recent.length * 400);
    return { error: "That's not the password." };
  }
  failures.delete(ip);
  await startSession();

  // Only same-site paths, never "//host" or absolute URLs.
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/reader");
}
