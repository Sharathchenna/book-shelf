import "server-only";
import { timingSafeEqual } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";

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
