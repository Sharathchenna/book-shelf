import "server-only";

/**
 * Wrong password guesses per address, for the login form and the app's sign-in. Kept in memory,
 * so it's per Worker instance: a speed bump on top of the delay, not a guarantee. A long password
 * is the real protection.
 */
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 8;
const failures = new Map<string, number[]>();

// Slows down guessing; the password check itself is constant-time.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const clientAddress = (h: Headers) => h.get("cf-connecting-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

/** Whether this address has guessed wrong too often lately. */
export function throttled(ip: string): boolean {
  const now = Date.now();
  return (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS).length >= MAX_FAILURES;
}

/** Records a wrong guess, then waits longer the more there have been. */
export async function failed(ip: string) {
  const now = Date.now();
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  failures.set(ip, [...recent, now]);
  if (failures.size > 5000) failures.delete(failures.keys().next().value!);
  await delay(600 + recent.length * 400);
}

export const succeeded = (ip: string) => void failures.delete(ip);
