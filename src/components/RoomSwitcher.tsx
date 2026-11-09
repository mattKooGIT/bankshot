"use client";

import { useTransition } from "react";
import { switchRoom } from "@/app/rooms/actions";

export function RoomSwitcher({ rooms, currentId }: { rooms: { id: string; name: string }[]; currentId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <label className="flex items-center gap-2 text-white/60">
      <span className="sr-only">Room</span>
      <select
        value={currentId}
        disabled={pending}
        onChange={(e) => startTransition(() => switchRoom(e.target.value))}
        className="max-w-40 rounded-md border border-white/15 bg-white/5 px-2 py-1 text-white outline-none focus:border-white/40 disabled:opacity-50"
      >
        {rooms.map((r) => <option key={r.id} value={r.id} className="bg-[#15181d]">{r.name}</option>)}
      </select>
    </label>
  );
}
