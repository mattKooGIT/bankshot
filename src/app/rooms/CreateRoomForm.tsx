"use client";

import { useActionState } from "react";
import type { FormState } from "@/lib/forms";
import { createRoom } from "./actions";

const input = "w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 outline-none focus:border-white/40";

export function CreateRoomForm({ minEndDate }: { minEndDate: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(createRoom, {});
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1 sm:col-span-2">
        <span className="text-sm text-white/70">Room name</span>
        <input name="name" required maxLength={40} placeholder="Friday Night Hoops" className={input} />
      </label>
      <label className="space-y-1">
        <span className="text-sm text-white/70">Starting cash</span>
        <input name="starting_cash" type="number" required min={1000} max={1000000} step={1} defaultValue={10000} className={`${input} font-mono`} />
      </label>
      <label className="space-y-1">
        <span className="text-sm text-white/70">Member cap <span className="text-white/40">(optional, 2–50)</span></span>
        <input name="member_cap" type="number" min={2} max={50} step={1} className={`${input} font-mono`} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="text-sm text-white/70">End date <span className="text-white/40">(optional; trading locks after this day, US Eastern)</span></span>
        <input name="ends_at" type="date" min={minEndDate} className={input} />
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button disabled={pending} className="rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
          {pending ? "Creating…" : "Create room"}
        </button>
        {state.message && <p role="alert" className="text-sm text-red-300">{state.message}</p>}
      </div>
    </form>
  );
}
