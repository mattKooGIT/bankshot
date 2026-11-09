"use client";

import Link from "next/link";
import { useLive } from "@/lib/useLive";
import type { LiveData, LiveGame, LiveLine } from "@/lib/live";
import { GameCard } from "./GameCard";

export type MyHolding = {
  ticker: string; name: string; espnId: string; team: string; expectedFp: number; shares: number; out: boolean;
};

const timeET = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

export function ScoresView({ initial, holdings, roomName, tickerByEspnId }: {
  initial: LiveData; holdings: MyHolding[] | null; roomName: string | null; tickerByEspnId: Record<string, string>;
}) {
  const live = useLive();
  const data = live.data ?? initial;
  const delayed = data.stale || live.error;

  return (
    <div className="mt-6 space-y-10">
      {delayed && (
        <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Live data delayed · last updated {timeET.format(new Date(data.updatedAt))} ET
        </p>
      )}
      <YourPlayers holdings={holdings} roomName={roomName} games={data.games} lines={data.lines} />
      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Games</h2>
        {data.games.length === 0 ? (
          <p className="rounded-xl border border-white/10 p-8 text-center text-sm text-white/60">No games today.</p>
        ) : (
          <div className="grid items-start gap-3 md:grid-cols-2">
            {data.games.map((g) => (
              <GameCard key={g.id} game={g} lines={data.lines.filter((l) => l.gameId === g.id)} tickerByEspnId={tickerByEspnId} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function YourPlayers({ holdings, roomName, games, lines }: {
  holdings: MyHolding[] | null; roomName: string | null; games: LiveGame[]; lines: LiveLine[];
}) {
  if (!holdings) {
    return (
      <section className="rounded-xl border border-white/10 p-6 text-sm text-white/60">
        <Link href="/login?next=/scores" className="text-emerald-300 underline">Sign in</Link> to follow the players you own tonight.
      </section>
    );
  }

  const lineById = new Map(lines.map((l) => [l.espnId, l]));
  // Match by ESPN id first (a traded player's listed team can lag), then by team.
  const gameFor = (h: MyHolding) => {
    const l = lineById.get(h.espnId);
    return (l && games.find((g) => g.id === l.gameId)) || games.find((g) => g.home.abbr === h.team || g.away.abbr === h.team);
  };
  const playing = holdings.map((h) => ({ h, game: gameFor(h), line: lineById.get(h.espnId) })).filter((x) => x.game);
  const notPlaying = holdings.filter((h) => !gameFor(h));

  return (
    <section>
      <h2 className="mb-1 text-sm font-medium text-white/60">Your players tonight{roomName ? ` · ${roomName}` : ""}</h2>
      <p className="mb-3 text-xs text-white/40">Prices update overnight from final box scores. Live numbers don&apos;t move prices yet.</p>
      {holdings.length === 0 ? (
        <p className="rounded-xl border border-white/10 p-6 text-sm text-white/60">
          You don&apos;t own any players in this room. <Link href="/market" className="text-emerald-300 underline">Browse the market</Link>.
        </p>
      ) : (
        <>
          {playing.length > 0 && (
            <ul className="divide-y divide-white/5 overflow-hidden rounded-lg border border-white/10 text-sm">
              {playing.map(({ h, game, line }) => {
                const fp = line?.fp ?? 0;
                return (
                  <li key={h.ticker} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                    <Link href={`/players/${h.ticker}`} className="w-24 shrink-0 font-mono font-semibold text-emerald-300">{h.ticker}</Link>
                    <span className="min-w-32 flex-1">{h.name} <span className="text-xs text-white/40">× {h.shares}</span></span>
                    <span className={`text-xs ${game!.state === "in" ? "text-red-300" : "text-white/50"}`}>{h.out ? "Out" : game!.status}</span>
                    {line && game!.state !== "pre" && (
                      <>
                        <span className="font-mono text-xs text-white/70">
                          {line.min} MIN · {line.pts} PTS {line.reb} REB {line.ast} AST {line.stl} STL {line.blk} BLK {line.tov} TOV
                        </span>
                        <span className={`w-36 text-right font-mono text-xs ${fp >= h.expectedFp ? "text-emerald-400" : "text-red-400"}`}>
                          {fp.toFixed(1)} FP vs {h.expectedFp.toFixed(1)} exp
                        </span>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {notPlaying.length > 0 && (
            <details className="mt-3 text-sm text-white/60">
              <summary className="cursor-pointer hover:text-white">Not playing tonight ({notPlaying.length})</summary>
              <p className="mt-2 text-xs">{notPlaying.map((h) => h.ticker).join(", ")}</p>
            </details>
          )}
        </>
      )}
    </section>
  );
}
