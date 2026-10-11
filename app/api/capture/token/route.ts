import { captureTokenCreated, createCaptureToken, requireOwner, revokeCaptureToken } from "@/lib/auth/session";

/**
 * The capture token for the phone shortcut. GET says whether one exists (never the token itself),
 * POST makes a new one (the old stops working) and returns it once, DELETE turns capture off.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return Response.json({ created: await captureTokenCreated() }, { headers: { "cache-control": "no-store" } });
}

export async function POST() {
  const denied = await requireOwner();
  if (denied) return denied;
  const token = await createCaptureToken();
  return Response.json({ token, created: await captureTokenCreated() }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  const denied = await requireOwner();
  if (denied) return denied;
  await revokeCaptureToken();
  return new Response(null, { status: 204 });
}
