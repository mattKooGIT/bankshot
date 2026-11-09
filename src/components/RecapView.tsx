import Link from "next/link";
import { rankMove } from "@/lib/feed";
import { formatMoney } from "@/lib/format";
import { pct1, type Recap, type RecapPlayer } from "@/lib/recap";

export type TopRow = { username: string; net_worth: number; rank: number };

function Player({ label, p }: { label: string; p: RecapPlayer | null }) {
  if (!p) return null;
  const l = p.line;
  return (
    <div className="flex-1 rounded-lg border border-white/10 p-4">
      <p className="text-xs text-white/50">{label}</p>
      <Link href={`/players/${p.ticker}`} className="mt-1 flex items-baseline gap-2 hover:underline">
        <span className="font-semibold text-emerald-300">{p.ticker}</span>
        <span className="text-white/70">{p.name}</span>
        <span className={`ml-auto tabular-nums ${p.total >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pct1(p.total)}</span>
      </Link>
      <p className="mt-1 text-xs tabular-nums text-white/50">
        {l ? `${l.pts} PTS ${l.reb} REB ${l.ast} AST ${l.stl} STL ${l.blk} BLK ${l.tov} TOV`
          : p.status === "injured" ? "Out" : p.status === "rest" ? "Did not play" : "No game"}
      </p>
    </div>
  );
}

/** The body of /recap (also rendered by the dev preview with fixture data). */
export function RecapView({ recap, tops, me }: { recap: Recap; tops: Record<string, TopRow[]>; me: string }) {
  return (
    <div className="space-y-8">
      <p className="text-sm text-white/60">Game night {recap.night}{recap.date ? `, ${recap.date}` : ""}</p>
      <ul className="space-y-3">
        {recap.rooms.map((r) => (
          <li key={r.room_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Link href={r.is_public ? "/leaderboard" : `/rooms/${r.room_id}`} className="font-medium hover:underline">{r.room_name}</Link>
              <span className={`tabular-nums ${r.change_pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pct1(r.change_pct)}</span>
              <span className="tabular-nums text-white/70">#{r.rank} of {r.size}</span>
              <span className="text-xs text-white/50">{rankMove(r.rank, r.prev_rank)}</span>
              <span className="ml-auto tabular-nums">{formatMoney(r.net_worth)}</span>
            </div>
            {tops[r.room_id]?.length ? (
              <ol className="mt-3 space-y-0.5 text-xs tabular-nums text-white/60">
                {tops[r.room_id].map((t) => (
                  <li key={t.username} className={t.username === me ? "text-white" : ""}>
                    #{t.rank} {t.username} · {formatMoney(t.net_worth)}
                  </li>
                ))}
              </ol>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Player label="Your best player last night" p={recap.best} />
        <Player label="Your worst player last night" p={recap.worst} />
      </div>
    </div>
  );
}
