"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/forms";
import { joinRoom } from "@/app/rooms/actions";

export function JoinButton({ code, roomName }: { code: string; roomName: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending}
        onClick={() => startTransition(async () => setState(await joinRoom(code)))}
        className="w-full rounded-lg bg-emerald-500 px-4 py-2.5 font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
        {pending ? "Joining…" : `Join ${roomName}`}
      </button>
      {state.message && <p role="alert" className="text-sm text-red-300">{state.message}</p>}
    </div>
  );
}
