"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/forms";
import { updateEmail, updateUsername } from "./actions";

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-white/40";
const button = "rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black hover:bg-emerald-400 disabled:opacity-50";

function Result({ state }: { state: FormState }) {
  if (!state.message) return null;
  return <p role="status" className={`text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}>{state.message}</p>;
}

export function UsernameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateUsername, {});
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="username" className="block text-sm text-white/70">Username</label>
      <div className="flex gap-2">
        <input id="username" name="username" defaultValue={current} required minLength={3} maxLength={20}
          pattern="[A-Za-z0-9_]{3,20}" autoComplete="username" className={input} />
        <button disabled={pending} className={button}>{pending ? "Saving…" : "Save"}</button>
      </div>
      <p className="text-xs text-white/40">3–20 letters, numbers, or underscores. Shown on leaderboards and in rooms.</p>
      <Result state={state} />
    </form>
  );
}

export function EmailForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(updateEmail, {});
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="email" className="block text-sm text-white/70">Email</label>
      <p className="text-sm text-white/50">Currently <span className="text-white">{current}</span></p>
      <div className="flex gap-2">
        <input id="email" name="email" type="email" required placeholder="new@example.com" autoComplete="email" className={input} />
        <button disabled={pending} className={button}>{pending ? "Sending…" : "Change"}</button>
      </div>
      <Result state={state} />
    </form>
  );
}
