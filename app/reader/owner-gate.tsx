import { redirect } from "next/navigation";
import { isOwner } from "@/lib/auth/session";

/**
 * Server-side check for reader pages (proxy.ts only redirects when the cookie is missing).
 * Reading cookies is request-time work, so pages render this inside <Suspense>.
 */
export async function OwnerGate({ next, children }: { next: string; children: React.ReactNode }) {
  if (!(await isOwner())) redirect(`/login?next=${encodeURIComponent(next)}`);
  return children;
}
