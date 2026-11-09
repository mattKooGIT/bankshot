import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { getMarket, getPlayer, getPriceHistory, type LastMove } from "@/lib/market";
import { formatMoney, formatPct } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "./TradePanel";

export async function generateStaticParams() {
  return (await getMarket()).map((p) => ({ ticker: p.ticker }));
}

export async function generateMetadata({ params }: PageProps<"/players/[ticker]">): Promise<Metadata> {
  const { ticker } = await params;
  return { title: `${ticker.toUpperCase()} · Courtside Exchange` };
}

export default async function PlayerPage({ params }: PageProps<"/players/[ticker]">) {
  const ticker = (await params).ticker.toUpperCase();
  const [player, history] = await Promise.all([getPlayer(ticker), getPriceHistory(ticker)]);
  if (!player) notFound();

  const change = player.last_move?.total ?? 0;
  const injured = player.out_nights > 0;
  const stats = [
    ["PTS", player.avg_pts], ["REB", player.avg_reb], ["AST", player.avg_ast],
    ["STL", player.avg_stl], ["BLK", player.avg_blk], ["TOV", player.avg_tov],
  ] as const;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Link href="/market" className="text-sm text-white/50 hover:text-white">← Market</Link>

      <div className="mt-4 grid gap-8 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0 space-y-8">
          <header className="flex items-center gap-4">
            {player.headshot_url && (
              <Image src={player.headshot_url} alt="" width={72} height={72} className="rounded-full bg-white/5 object-cover" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-emerald-300">{player.ticker}</span>
                {injured && <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold uppercase text-red-300">Out</span>}
              </div>
              <h1 className="text-2xl font-semibold">{player.name}</h1>
              <p className="text-sm text-white/50">
                {[player.team, { G: "Guard", F: "Forward", C: "Center" }[player.position]].filter(Boolean).join(" · ")}
                {player.games_played > 0 && ` · ${player.games_played} GP · ${player.avg_min.toFixed(1)} MPG`}
              </p>
            </div>
            <div className="ml-auto text-right">
              <div className="font-mono text-3xl">{formatMoney(player.price)}</div>
              <div className={`font-mono text-sm ${change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-white/40"}`}>
                {player.last_move ? `${formatPct(change)} last night` : "Opening price"}
              </div>
            </div>
          </header>

          {injured && player.injury_note && (
            <p className="rounded-lg border border-red-500/20 bg-red-500/5 p-3 text-sm text-red-200">{player.injury_note}</p>
          )}

          <PriceChart points={history} title={`${player.ticker} price by game night`} />

          {player.last_move && <WhyItMoved move={player.last_move} />}

          <div>
            <h2 className="mb-3 text-sm font-medium text-white/60">Season averages</h2>
            <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 sm:grid-cols-7">
              {stats.map(([k, v]) => (
                <div key={k} className="bg-background p-3">
                  <dt className="text-xs text-white/50">{k}</dt>
                  <dd className="font-mono text-lg">{v.toFixed(1)}</dd>
                </div>
              ))}
              <div className="bg-background p-3">
                <dt className="text-xs text-white/50">Exp. FP</dt>
                <dd className="font-mono text-lg">{player.expected_fp.toFixed(1)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-white/40">
              Fantasy points = PTS + 1.2×REB + 1.5×AST + 3×STL + 3×BLK − TOV.
              {player.last5.length > 0 && ` Last ${player.last5.length}: ${player.last5.map((f) => f.toFixed(1)).join(", ")}.`}
            </p>
          </div>
        </section>

        <aside className="h-fit rounded-xl border border-white/10 bg-white/[0.02] p-5 lg:sticky lg:top-6">
          <h2 className="mb-4 font-medium">Trade {player.ticker}</h2>
          <Suspense fallback={<div className="h-72 animate-pulse rounded-lg bg-white/5" />}>
            <TradePanel ticker={player.ticker} price={player.price} injured={injured} />
          </Suspense>
        </aside>
      </div>
    </main>
  );
}

function WhyItMoved({ move }: { move: LastMove }) {
  const parts = [
    ["Performance", move.perf, move.status === "played" ? `${move.fp?.toFixed(1)} FP vs ${move.expected} expected`
      : move.status === "injured" ? "Listed out" : move.status === "rest" ? "Did not play" : "No game"],
    ["Fair-value pull", move.gap, "Price drifts toward recent form"],
    ["Trader demand", move.demand, `${move.demand_shares > 0 ? "+" : ""}${move.demand_shares} net shares bought`],
    ["Market noise", move.noise, "Random drift"],
  ] as const;
  const line = move.line;

  return (
    <div>
      <h2 className="mb-3 text-sm font-medium text-white/60">
        Why it moved · night {move.night}{move.date ? ` (${move.date})` : ""}
      </h2>
      {line && (
        <p className="mb-3 font-mono text-sm">
          {line.pts} PTS · {line.reb} REB · {line.ast} AST · {line.stl} STL · {line.blk} BLK · {line.tov} TOV
          {line.min != null && ` · ${line.min} MIN`}
        </p>
      )}
      <table className="w-full text-sm">
        <tbody>
          {parts.map(([label, v, note]) => (
            <tr key={label} className="border-t border-white/5">
              <td className="py-2">{label}</td>
              <td className="py-2 text-white/50">{note}</td>
              <td className={`py-2 text-right font-mono ${v > 0 ? "text-emerald-400" : v < 0 ? "text-red-400" : "text-white/40"}`}>{formatPct(v)}</td>
            </tr>
          ))}
          <tr className="border-t border-white/15 font-medium">
            <td className="py-2">Total</td><td />
            <td className="py-2 text-right font-mono">{formatPct(move.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
