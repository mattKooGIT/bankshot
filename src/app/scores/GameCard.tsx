"use client";

import Link from "next/link";
import { useState } from "react";
import type { LiveGame, LiveLine } from "@/lib/live";

const COLS = ["min", "pts", "reb", "ast", "stl", "blk", "tov"] as const;

export function GameCard({ game, lines, tickerByEspnId }: {
  game: LiveGame; lines: LiveLine[]; tickerByEspnId: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const live = game.state === "in";
  const team = (abbr: string, score: number | null, other: number | null) => (
    <div className="flex items-center justify-between">
      <span className="font-medium">{abbr}</span>
      <span className={`font-mono text-lg ${score !== null && other !== null && score > other ? "text-white" : "text-white/60"}`}>
        {score ?? ""}
      </span>
    </div>
  );

  return (
    <div className={`rounded-xl border ${live ? "border-red-500/30" : "border-white/10"} bg-white/[0.02]`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        disabled={game.state === "pre"} className="w-full p-4 text-left disabled:cursor-default">
        <div className="mb-2 flex items-center justify-between text-xs">
          <span className={live ? "font-semibold text-red-300" : "text-white/50"}>{game.status}</span>
          {game.state !== "pre" && <span className="text-white/40">{open ? "Hide box score" : "Box score"}</span>}
        </div>
        {team(game.away.abbr, game.away.score, game.home.score)}
        {team(`@ ${game.home.abbr}`, game.home.score, game.away.score)}
      </button>
      {open && (
        <div className="space-y-4 border-t border-white/10 p-4">
          {[game.away.abbr, game.home.abbr].map((abbr) => (
            <table key={abbr} className="w-full text-xs">
              <thead className="text-white/40">
                <tr>
                  <th className="text-left font-medium">{abbr}</th>
                  {COLS.map((c) => <th key={c} className="w-9 text-right font-medium uppercase">{c === "tov" ? "TO" : c}</th>)}
                  <th className="w-11 text-right font-medium">FP</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {lines.filter((l) => l.team === abbr).sort((a, b) => b.min - a.min).map((l) => {
                  const ticker = tickerByEspnId[l.espnId];
                  return (
                    <tr key={l.espnId} className="border-t border-white/5">
                      <td className="py-1 font-sans">
                        {ticker ? <Link href={`/players/${ticker}`} className="hover:underline">{l.name} <span className="font-mono text-emerald-300">{ticker}</span></Link> : l.name}
                      </td>
                      {COLS.map((c) => <td key={c} className="text-right">{l[c]}</td>)}
                      <td className="text-right">{l.fp.toFixed(1)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ))}
        </div>
      )}
    </div>
  );
}
