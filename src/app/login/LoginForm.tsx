"use client";

import { useActionState } from "react";
import { signInWithEmail, signInWithGoogle, type LoginState } from "./actions";

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [state, emailAction, pending] = useActionState<LoginState, FormData>(signInWithEmail, {});

  if (state.sent) {
    return (
      <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
        Check <strong>{state.sent}</strong> for a sign-in link. You can close this tab.
      </p>
    );
  }

  const message = state.error ?? error;
  return (
    <div className="space-y-6">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <button className="w-full rounded-lg border border-white/15 bg-white px-4 py-2.5 font-medium text-black hover:bg-white/90">
          Continue with Google
        </button>
      </form>

      <div className="flex items-center gap-3 text-xs text-white/40">
        <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
      </div>

      <form action={emailAction} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <label className="block text-sm text-white/70" htmlFor="email">Email</label>
        <input
          id="email" name="email" type="email" required autoComplete="email"
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 outline-none focus:border-white/40"
        />
        <button disabled={pending} className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </form>

      {message && <p role="alert" className="text-sm text-red-400">{message}</p>}
    </div>
  );
}
