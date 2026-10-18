import { requestDevice, startSession } from "@/lib/auth/session";

/**
 * A signed-in device's way into the site's own pages: GET with the device token (as a header,
 * which no other site can send) starts a browser session in the device's web view and goes on to
 * `next`. The Android app uses it to have the site make an article's or paper's ebook (the openers
 * build them in the browser) and for anything it shows from the site itself.
 */
export async function GET(request: Request) {
  if (!(await requestDevice())) return Response.json({ error: "Not a signed-in device." }, { status: 401 });
  await startSession();
  const next = new URL(request.url).searchParams.get("next") ?? "/";
  // Only same-site paths, never "//host" or absolute URLs.
  const to = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });
}
