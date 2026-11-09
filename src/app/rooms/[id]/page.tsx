import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatPct } from "@/lib/format";
import { siteOrigin } from "@/lib/origin";
import { getCurrentRoom, getMyRooms, isRoomEnded } from "@/lib/rooms";
import { switchRoom } from "../actions";
import { InviteLink, RemoveMemberButton } from "./OwnerControls";
import { DangerZone } from "./DangerZone";

export const metadata: Metadata = { title: "Room · Courtside Exchange" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function RoomPage({ params }: PageProps<"/rooms/[id]">) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/rooms" className="text-sm text-white/50 hover:text-white">← Rooms</Link>
      <Suspense fallback={<div className="mt-4 h-96 animate-pulse rounded-xl bg-white/5" />}>
        <RoomView params={params} />
      </Suspense>
    </main>
  );
}

type Row = { rank: number; username: string; net_worth: number | string; is_me: boolean };
type Member = { user_id: string; username: string; joined_at: string; is_owner: boolean };

async function RoomView({ params }: Pick<PageProps<"/rooms/[id]">, "params">) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [rooms, current] = await Promise.all([getMyRooms(), getCurrentRoom()]);
  const room = rooms.find((r) => r.id === id);
  if (!room || room.is_public || !current) notFound(); // members only

  const supabase = await createClient();
  const isOwner = room.owner_id === current.userId;
  const [{ data: board }, { data: roster }, invite] = await Promise.all([
    supabase.rpc("leaderboard", { p_room: id, p_limit: 200 }),
    supabase.rpc("room_roster", { p_room: id }),
    isOwner ? supabase.rpc("room_invite", { p_room: id }) : Promise.resolve({ data: null }),
  ]);
  const rows = (board ?? []) as Row[];
  const members = (roster ?? []) as Member[];
  const final = room.finalized_at !== null;
  const ended = isRoomEnded(room);
  const inviteUrl = invite.data ? `${await siteOrigin()}/join/${invite.data}` : null;

  return (
    <div className="mt-4 space-y-8">
      <header className="flex flex-wrap items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 text-sm text-white/60">
            {formatMoney(room.starting_cash)} starting cash · {members.length}{room.member_cap ? ` of ${room.member_cap}` : ""} members ·{" "}
            {final ? <span className="text-amber-300">Final · Winner: {rows[0]?.username}</span>
              : ended ? "Ended — final standings lock after the next game night"
              : room.ends_at ? `Ends ${room.ends_at} (US Eastern)` : "No end date"}
          </p>
        </div>
        {current.room.id === id ? (
          <span className="rounded-md bg-emerald-500/15 px-3 py-1.5 text-sm text-emerald-300">Trading in this room</span>
        ) : !ended && (
          <form action={switchRoom.bind(null, id)}>
            <button className="rounded-md border border-white/15 px-3 py-1.5 text-sm hover:border-white/40">Switch to this room</button>
          </form>
        )}
      </header>

      {inviteUrl && (
        <section className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="text-sm font-medium">Invite friends</h2>
          <p className="text-xs text-white/50">Anyone with this link can join{room.member_cap ? ` until the room has ${room.member_cap} members` : ""}.</p>
          <InviteLink roomId={id} url={inviteUrl} />
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Standings{final && " (final)"}</h2>
        <ol className="overflow-hidden rounded-lg border border-white/10 text-sm">
          {rows.map((r) => {
            const worth = Number(r.net_worth);
            const ret = worth / room.starting_cash - 1;
            return (
              <li key={r.username} className={`flex items-center gap-4 border-t border-white/5 px-4 py-2.5 first:border-t-0 ${r.is_me ? "bg-emerald-500/10" : ""}`}>
                <span className="w-8 text-right font-mono text-white/50">{r.rank}</span>
                <span className="flex-1">{r.username}{r.is_me && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 text-[10px] font-semibold uppercase text-emerald-300">You</span>}</span>
                <span className={`w-20 text-right font-mono text-xs ${ret > 0 ? "text-emerald-400" : ret < 0 ? "text-red-400" : "text-white/40"}`}>{formatPct(ret)}</span>
                <span className="w-28 text-right font-mono">{formatMoney(worth)}</span>
              </li>
            );
          })}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Members</h2>
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 px-4 py-2">
              <span className="flex-1">{m.username}{m.is_owner && <span className="ml-2 text-xs text-white/40">owner</span>}</span>
              <time className="text-xs text-white/40" dateTime={m.joined_at}>
                joined {new Date(m.joined_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}
              </time>
              {isOwner && !m.is_owner && <RemoveMemberButton roomId={id} userId={m.user_id} username={m.username} />}
            </li>
          ))}
        </ul>
      </section>

      <DangerZone roomId={id} roomName={room.name} isOwner={isOwner} ended={ended}
        heir={members.find((m) => !m.is_owner)?.username ?? null} />
    </div>
  );
}
