"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ownerConfigured, passwordMatches, startSession } from "@/lib/auth/session";
import { clientAddress, failed, succeeded, throttled } from "@/lib/auth/throttle";

export type LoginState = { error?: string };

export async function login(_state: LoginState, form: FormData): Promise<LoginState> {
  if (!ownerConfigured()) return { error: "Owner login isn't set up on this server (OWNER_PASSWORD, SESSION_SECRET)." };

  const ip = clientAddress(await headers());
  if (throttled(ip)) return { error: "Too many wrong tries. Wait a few minutes and try again." };

  const password = String(form.get("password") ?? "");
  if (!passwordMatches(password)) {
    await failed(ip);
    return { error: "That's not the password." };
  }
  succeeded(ip);
  await startSession();

  // Only same-site paths, never "//host" or absolute URLs.
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}
