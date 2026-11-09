"use client";

import Link from "next/link";
import { useLive } from "@/lib/useLive";

/** Tonight's live stat line for this player; renders nothing when his team has no game today. */
export function LiveLine({ espnId, team, expectedFp }: { espnId: string | null; team: string | null; expectedFp: number }) {
  const { data } = useLive();
  if (!data) return null;
  const line = espnId ? data.lines.find((l) => l.espnId === espnId) : undefined;
  const game = (line && data.games.find((g) => g.id === line.gameId))
    ?? data.games.find((g) => team !== null && (g.home.abbr === team || g.away.abbr === team));
  if (!game) return null;

  if (game.state === "pre") {
    return <p className="text-sm text-white/60">Tips {game.status} tonight · {game.away.abbr} @ {game.home.abbr}</p>;
  }

  const fp = line?.fp ?? 0;
  return (
    <Link href="/scores" className={`block rounded-lg border px-3 py-2 text-sm hover:border-white/30 ${game.state === "in" ? "border-red-500/30 bg-red-500/5" : "border-white/10"}`}>
      <span className={game.state === "in" ? "font-semibold text-red-300" : "text-white/60"}>
        {game.state === "in" ? `Live · ${game.status}` : game.status}
      </span>
      {line ? (
        <>
          <span className="font-mono text-white/80"> · {line.pts} PTS {line.reb} REB {line.ast} AST {line.stl} STL {line.blk} BLK {line.tov} TOV</span>
          <span className={`font-mono ${fp >= expectedFp ? "text-emerald-400" : "text-red-400"}`}> · {fp.toFixed(1)} FP vs {expectedFp.toFixed(1)} expected</span>
        </>
      ) : (
        <span className="text-white/50"> · hasn&apos;t played yet</span>
      )}
    </Link>
  );
}
