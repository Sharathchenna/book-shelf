import { NextResponse, type NextRequest } from "next/server";

// Kept in sync with SESSION_COOKIE in lib/auth/session.ts (that module is server-only).
const SESSION_COOKIE = "shelf_session";

/**
 * Optimistic check only: sends visitors without a session cookie to the login page.
 * Pages and API routes still verify the session themselves (see lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/reader", "/reader/:path*"],
};
