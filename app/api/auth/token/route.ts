import { createDeviceToken, ownerConfigured, passwordMatches, requestDevice, revokeDevice } from "@/lib/auth/session";
import { clientAddress, failed, succeeded, throttled } from "@/lib/auth/throttle";

/**
 * Signing a device in (the Android app): POST { password, name } returns a device token, once,
 * to send as `Authorization: Bearer …`. DELETE with that token signs the device out.
 */
export async function POST(request: Request) {
  if (!ownerConfigured()) return Response.json({ error: "Owner login isn't set up on this server." }, { status: 503 });
  const ip = clientAddress(request.headers);
  if (throttled(ip)) return Response.json({ error: "Too many wrong tries. Wait a few minutes and try again." }, { status: 429 });

  const body = (await request.json().catch(() => ({}))) as { password?: unknown; name?: unknown };
  if (typeof body.password !== "string" || !passwordMatches(body.password)) {
    await failed(ip);
    return Response.json({ error: "That's not the password." }, { status: 401 });
  }
  succeeded(ip);
  const { token, device } = await createDeviceToken(typeof body.name === "string" ? body.name.trim() : "");
  return Response.json({ token, device }, { headers: { "cache-control": "no-store" } });
}

export async function DELETE() {
  const device = await requestDevice();
  if (!device) return Response.json({ error: "Not a signed-in device." }, { status: 401 });
  await revokeDevice(device.id);
  return new Response(null, { status: 204 });
}
