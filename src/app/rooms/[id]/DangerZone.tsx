"use client";

import { useState, useTransition } from "react";
import type { FormState } from "@/lib/forms";
import { deleteRoom, leaveRoom } from "../actions";

export function DangerZone({ roomId, roomName, isOwner, ended, heir }: {
  roomId: string; roomName: string; isOwner: boolean; ended: boolean; heir: string | null;
}) {
  const [state, setState] = useState<FormState>({});
  const [pending, startTransition] = useTransition();
  const run = (question: string, action: () => Promise<FormState>) => {
    if (!confirm(question)) return;
    startTransition(async () => setState(await action()));
  };

  const leaveNote = !isOwner ? "Your cash, holdings and trades in this room are deleted."
    : heir ? `Ownership passes to ${heir}. Your cash, holdings and trades in this room are deleted.`
    : "You're the last member, so leaving deletes the room.";

  return (
    <section className="space-y-3 rounded-xl border border-red-500/20 p-5">
      <h2 className="text-sm font-medium text-red-300">Danger zone</h2>
      {!ended && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending}
            onClick={() => run(`Leave ${roomName}? ${leaveNote}`, () => leaveRoom(roomId))}
            className="rounded-md border border-red-500/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">
            Leave room
          </button>
          <span className="text-xs text-white/50">{leaveNote}</span>
        </div>
      )}
      {isOwner && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={pending}
            onClick={() => run(`Delete ${roomName} for everyone? All members' cash, holdings and trades in this room are deleted. This can't be undone.`, () => deleteRoom(roomId))}
            className="rounded-md bg-red-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-red-400 disabled:opacity-50">
            Delete room
          </button>
          <span className="text-xs text-white/50">Deletes the room and everyone&apos;s data in it.</span>
        </div>
      )}
      {ended && !isOwner && <p className="text-xs text-white/50">This room has ended, so its final standings are locked.</p>}
      {state.message && !state.ok && <p role="alert" className="text-sm text-red-300">{state.message}</p>}
    </section>
  );
}
