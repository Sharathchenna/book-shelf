import { endSession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await endSession();
  return Response.redirect(new URL("/", request.url), 303);
}
