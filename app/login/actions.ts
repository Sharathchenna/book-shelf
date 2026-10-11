"use server";

import { redirect } from "next/navigation";
import { ownerConfigured, passwordMatches, startSession } from "@/lib/auth/session";

export type LoginState = { error?: string };

// Slows down guessing; the password check itself is constant-time.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  if (!ownerConfigured()) return { error: "Owner login isn't set up on this server (OWNER_PASSWORD, SESSION_SECRET)." };

  const password = String(form.get("password") ?? "");
  if (!passwordMatches(password)) {
    await delay(600);
    return { error: "That's not the password." };
  }
  await startSession();

  // Only same-site paths, never "//host" or absolute URLs.
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/reader");
}
