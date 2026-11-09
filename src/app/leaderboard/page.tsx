import type { Metadata } from "next";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatPct } from "@/lib/format";
import { getCurrentRoom, getPublicRoom, isRoomEnded } from "@/lib/rooms";

export const metadata: Metadata = { title: "Leaderboard · Courtside Exchange" };

export default function LeaderboardPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-white/5" />}>
        <Board />
      </Suspense>
    </main>
  );
}

type Row = { rank: number; username: string; net_worth: number | string; is_me: boolean };

async function Board() {
  // Your current room when signed in, otherwise the Public room.
  const room = (await getCurrentRoom())?.room ?? (await getPublicRoom());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leaderboard", { p_room: room.id, p_limit: 100 });
  if (error) throw new Error(`Couldn't load the leaderboard: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const final = room.finalized_at !== null;

  return (
    <>
      <h1 className="text-2xl font-semibold">
        Leaderboard <span className="text-white/40">· {room.name}</span>
        {final && <span className="ml-2 rounded bg-amber-500/15 px-1.5 align-middle text-xs font-semibold uppercase text-amber-300">Final</span>}
      </h1>
      <p className="mt-1 mb-6 text-sm text-white/60">
        Net worth = cash + shares at {final ? "the final night's" : "current"} prices. Everyone started with {formatMoney(room.starting_cash)}.
        {!final && isRoomEnded(room) && " This room has ended; final standings lock after the next game night."}
      </p>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-8 text-center text-sm text-white/60">No traders yet.</p>
      ) : (
        <ol className="overflow-hidden rounded-lg border border-white/10 text-sm">
          {rows.map((r) => {
            const worth = Number(r.net_worth);
            const ret = worth / room.starting_cash - 1;
            return (
              <li key={r.username}
                className={`flex items-center gap-4 border-t border-white/5 px-4 py-2.5 first:border-t-0 ${r.is_me ? "bg-emerald-500/10" : ""}`}>
                <span className="w-8 text-right font-mono text-white/50">{r.rank}</span>
                <span className="flex-1">
                  {r.username}
                  {r.is_me && <span className="ml-2 rounded bg-emerald-500/20 px-1.5 text-[10px] font-semibold uppercase text-emerald-300">You</span>}
                </span>
                <span className={`w-20 text-right font-mono text-xs ${ret > 0 ? "text-emerald-400" : ret < 0 ? "text-red-400" : "text-white/40"}`}>
                  {formatPct(ret)}
                </span>
                <span className="w-28 text-right font-mono">{formatMoney(worth)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
