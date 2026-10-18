import { listDevices, requireOwner, revokeDevice } from "@/lib/auth/session";

/** The devices signed in as the owner: GET lists them, DELETE ?id=… signs one out. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;
  return Response.json({ devices: await listDevices() }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE(request: Request) {
  const denied = await requireOwner();
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!(await revokeDevice(id))) return Response.json({ error: "Unknown device." }, { status: 404 });
  return new Response(null, { status: 204 });
}
