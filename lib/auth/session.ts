import "server-only";
import { timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { getMeta, setMeta } from "../data";

/**
 * The site has one private user: its owner. The session is a signed JWT in an httpOnly cookie
 * (the stateless pattern from Next's authentication guide); there is no user database.
 */
const COOKIE = "shelf_session";
const SESSION_DAYS = 30;

export const ownerConfigured = () => Boolean(process.env.OWNER_PASSWORD && process.env.SESSION_SECRET);

function secret(): Uint8Array {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET must be set to at least 32 characters.");
  return new TextEncoder().encode(value);
}

export function passwordMatches(attempt: string): boolean {
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(attempt);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Whether a request is the Worker's own cron (worker.ts), which presents the session secret as a
 * bearer token. It never leaves the Worker: the cron calls the route in-process.
 */
export function fromScheduler(request: Request): boolean {
  const expected = process.env.SESSION_SECRET;
  const given = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The phone shortcut and other tools that save links authenticate with a capture token: a
 * signed JWT that can only add clippings. It doesn't expire; making a new one (or turning it
 * off) revokes the old, since only the current token's id is kept, hashed, in the database.
 */
const CAPTURE_META = "capture_token";

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createCaptureToken(): Promise<string> {
  const jti = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await setMeta(CAPTURE_META, JSON.stringify({ hash: await sha256(jti), created: new Date().toISOString() }));
  return new SignJWT({ scope: "capture" }).setProtectedHeader({ alg: "HS256" }).setJti(jti).setIssuedAt().sign(secret());
}

export async function revokeCaptureToken() {
  await setMeta(CAPTURE_META, null);
}

/** When the current capture token was made, or null when there is none. */
export async function captureTokenCreated(): Promise<string | null> {
  const stored = await getMeta(CAPTURE_META);
  return stored ? (JSON.parse(stored) as { created: string }).created : null;
}

/** Whether the request carries the current capture token (Authorization: Bearer …). */
export async function fromCaptureToken(request: Request): Promise<boolean> {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token || !ownerConfigured()) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const stored = await getMeta(CAPTURE_META);
    if (payload.scope !== "capture" || !payload.jti || !stored) return false;
    const a = Buffer.from(await sha256(payload.jti));
    const b = Buffer.from((JSON.parse(stored) as { hash: string }).hash);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export async function startSession() {
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const token = await new SignJWT({ role: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(secret());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** The real authorization check; call it in every owner-only route and page. */
export async function isOwner(): Promise<boolean> {
  // Read the request's cookies before anything else: that is what makes every caller
  // request-time. Returning early first would let Next prerender the answer at build time.
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !ownerConfigured()) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    return payload.role === "owner";
  } catch {
    return false;
  }
}

/** For route handlers: a 401 response unless the request comes from the owner. */
export async function requireOwner(): Promise<Response | null> {
  return (await isOwner()) ? null : Response.json({ error: "Owner login required." }, { status: 401 });
}

/** Short-lived token authorising one read or write of one stored object (local storage driver). */
export function signBlobToken(key: string, action: "get" | "put", ttlSeconds: number, bytes?: number): Promise<string> {
  return new SignJWT({ key, action, ...(bytes !== undefined ? { bytes } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secret());
}

/** Returns the token's claims when it authorises `action` on `key`, else null. */
export async function verifyBlobToken(
  token: string,
  key: string,
  action: "get" | "put",
): Promise<{ bytes?: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.key !== key || payload.action !== action) return null;
    return { bytes: typeof payload.bytes === "number" ? payload.bytes : undefined };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE;
