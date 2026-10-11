"use client";

import { startTransition, useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(login, {});

  return (
    <form
      // Read ?next= at submit time: the page itself stays static, so the URL isn't known while rendering.
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        form.set("next", new URLSearchParams(window.location.search).get("next") ?? "/reader");
        startTransition(() => formAction(form));
      }}
      className="mt-7 flex flex-col gap-3 text-left"
    >
      <label className="text-xs font-medium tracking-[0.14em] text-muted uppercase" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
        className="rounded-full bg-chip px-5 py-3 outline-none focus:ring-2 focus:ring-accent/40"
      />
      {state.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="mt-2 rounded-full bg-ink py-3 text-sm font-medium text-ink-fg transition-transform hover:scale-[1.02] active:scale-95 disabled:opacity-60"
      >
        {pending ? "Opening…" : "Enter"}
      </button>
    </form>
  );
}
