import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { addDays, easternToday } from "@/lib/dates";
import { formatMoney } from "@/lib/format";
import { getCurrentRoom, getMyRooms } from "@/lib/rooms";
import { CreateRoomForm } from "./CreateRoomForm";

export const metadata: Metadata = { title: "Rooms · Courtside Exchange" };

export default function RoomsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Rooms</h1>
      <p className="mt-1 mb-6 text-sm text-white/60">
        Play with just your friends. Each room has its own bankroll and standings; prices are the same everywhere.
      </p>
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-white/5" />}>
        <Rooms />
      </Suspense>
    </main>
  );
}

type Row = { rank: number; net_worth: number | string; is_me: boolean };

async function Rooms() {
  const current = await getCurrentRoom();
  if (!current) {
    return (
      <div className="rounded-xl border border-white/10 p-8 text-center">
        <p className="text-white/60">Sign in to create a room or see the rooms you&apos;re in.</p>
        <Link href="/login?next=/rooms" className="mt-4 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-black">
          Sign in
        </Link>
      </div>
    );
  }

  const supabase = await createClient();
  const rooms = await getMyRooms();
  const standings = await Promise.all(rooms.map(async (room) => {
    const { data } = await supabase.rpc("leaderboard", { p_room: room.id, p_limit: 200 });
    const rows = (data ?? []) as Row[];
    return { room, me: rows.find((r) => r.is_me), size: rows.length };
  }));

  return (
    <div className="space-y-10">
      <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 text-sm">
        {standings.map(({ room, me, size }) => (
          <li key={room.id}>
            <Link href={room.is_public ? "/leaderboard" : `/rooms/${room.id}`}
              className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.03]">
              <span className="flex-1">
                {room.name}
                {room.id === current.room.id && <span className="ml-2 text-xs text-emerald-300">trading here</span>}
              </span>
              <span className="text-xs text-white/50">
                {room.finalized_at ? <span className="rounded bg-amber-500/15 px-1.5 font-semibold uppercase text-amber-300">Final</span>
                  : room.ends_at ? `Ends ${room.ends_at}` : "No end date"}
              </span>
              <span className="w-24 text-right text-white/60">{me ? `#${me.rank} of ${size}` : "—"}</span>
              <span className="w-28 text-right font-mono">{me ? formatMoney(me.net_worth) : "—"}</span>
            </Link>
          </li>
        ))}
      </ul>

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-4 font-medium">Create a room</h2>
        <CreateRoomForm minEndDate={addDays(easternToday(), 1)} />
      </section>
    </div>
  );
}
