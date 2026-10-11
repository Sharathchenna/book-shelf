import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "../components/logo";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="glass liquid rise w-full max-w-sm rounded-[28px] p-8 text-center">
        <Logo className="mx-auto size-12" />
        <h1 className="mt-5 font-serif text-4xl">The reading room</h1>
        <p className="mt-2 text-sm text-muted">Your books are private. Sign in to read them.</p>
        <LoginForm />
        <Link href="/" className="mt-6 inline-block text-sm text-muted hover:text-fg">
          ← Back to the shelf
        </Link>
      </div>
    </main>
  );
}
