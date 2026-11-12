import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatPct } from "@/lib/format";
import { PriceChart } from "@/components/PriceChart";
import { getCurrentRoom } from "@/lib/rooms";
import { addDays, easternToday } from "@/lib/dates";
import { dayLabel, gamesWithin, getTeamsUpcoming, matchup, nextGame, tipTime } from "@/lib/schedule";

export const metadata: Metadata = { title: "Portfolio · Bankshot" };

export default function PortfolioPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <Suspense fallback={<div className="h-96 animate-pulse rounded-xl bg-white/5" />}>
        <Portfolio />
      </Suspense>
    </main>
  );
}

type HoldingRow = {
  ticker: string;
  shares: number;
  avg_cost: number | string;
  players: { name: string; team: string | null; price: number | string; out_nights: number; last_move: { total: number } | null } | null;
};

async function Portfolio() {
  const current = await getCurrentRoom();

  if (!current) {
    return (
      <div className="rounded-xl border border-white/10 p-8 text-center">
        <h1 className="mb-2 text-2xl font-semibold">Portfolio</h1>
        <p className="text-white/60">Sign in to see your holdings and performance.</p>
        <Link href="/login?next=/portfolio" className="mt-4 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-black">
          Sign in
        </Link>
      </div>
    );
  }

  const { userId, room, cash } = current;
  const STARTING_CASH = room.starting_cash;
  const supabase = await createClient();
  // RLS restricts holdings, trades, and net worth history to this user's rows; filter to this room.
  const [{ data: holdingRows }, { data: trades }, { data: history }] = await Promise.all([
    supabase.from("holdings").select("ticker, shares, avg_cost, players(name, team, price, out_nights, last_move)")
      .eq("user_id", userId).eq("room_id", room.id),
    supabase.from("trades").select("id, ticker, side, shares, price, night, created_at")
      .eq("user_id", userId).eq("room_id", room.id).order("created_at", { ascending: false }).limit(20),
    supabase.from("net_worth_history").select("night, net_worth")
      .eq("user_id", userId).eq("room_id", room.id).order("night"),
  ]);

  const holdings = ((holdingRows ?? []) as unknown as HoldingRow[])
    .map((h) => {
      const price = Number(h.players?.price ?? 0);
      const cost = Number(h.avg_cost);
      const value = h.shares * price;
      return {
        ticker: h.ticker, name: h.players?.name ?? h.ticker, shares: h.shares, cost, price, value,
        pl: value - h.shares * cost, plPct: cost ? price / cost - 1 : 0,
        lastNight: h.players?.last_move?.total ?? null, out: (h.players?.out_nights ?? 0) > 0, team: h.players?.team ?? null,
      };
    })
    .sort((a, b) => b.value - a.value);

  const today = easternToday();
  const upcoming = await getTeamsUpcoming(holdings.flatMap((h) => (h.team ? [h.team] : [])), today, addDays(today, 13));
  const invested = holdings.reduce((s, h) => s + h.value, 0);
  const netWorth = cash + invested;
  const totalReturn = netWorth / STARTING_CASH - 1;
  const chartPoints = [
    { night: 0, price: STARTING_CASH },
    ...(history ?? []).map((r) => ({ night: r.night, price: Number(r.net_worth) })),
  ];

  const tiles = [
    { label: "Net worth", value: formatMoney(netWorth) },
    { label: "Cash", value: formatMoney(cash) },
    { label: "Holdings value", value: formatMoney(invested) },
    { label: "All-time return", value: formatPct(totalReturn), tone: totalReturn },
  ];

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold">Portfolio <span className="text-white/40">· {room.name}</span></h1>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <dt className="text-xs text-white/50">{t.label}</dt>
            <dd className={`mt-1 font-mono text-xl ${t.tone === undefined ? "" : t.tone > 0 ? "text-emerald-400" : t.tone < 0 ? "text-red-400" : ""}`}>
              {t.value}
            </dd>
          </div>
        ))}
      </dl>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Holdings</h2>
        {holdings.length === 0 ? (
          <div className="rounded-xl border border-white/10 p-8 text-center text-sm text-white/60">
            You don&apos;t own any players yet. <Link href="/market" className="text-emerald-300 hover:underline">Browse the market</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-white/50">
                <tr>
                  <th className="px-3 py-2 font-medium">Player</th>
                  <th className="px-3 py-2 text-right font-medium">Shares</th>
                  <th className="px-3 py-2 text-right font-medium">Avg cost</th>
                  <th className="px-3 py-2 text-right font-medium">Price</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-right font-medium">P/L</th>
                  <th className="px-3 py-2 text-right font-medium">Last night</th>
                  <th className="px-3 py-2 font-medium">Next</th>
                  <th className="px-3 py-2 text-right font-medium" title="Games in the next 7 days">Games (7d)</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.ticker} className="border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="px-3 py-2">
                      <Link href={`/players/${h.ticker}`} className="flex items-baseline gap-2">
                        <span className="w-24 shrink-0 font-mono font-semibold text-emerald-300">{h.ticker}</span>
                        <span>{h.name}</span>
                        {h.out && <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold uppercase text-red-300">Out</span>}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{h.shares}</td>
                    <td className="px-3 py-2 text-right font-mono text-white/70">{formatMoney(h.cost)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(h.price)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatMoney(h.value)}</td>
                    <td className={`px-3 py-2 text-right font-mono ${h.pl > 0 ? "text-emerald-400" : h.pl < 0 ? "text-red-400" : "text-white/40"}`}>
                      {h.pl >= 0 ? "+" : "−"}{formatMoney(Math.abs(h.pl))} <span className="text-xs">({formatPct(h.plPct)})</span>
                    </td>
                    <td className={`px-3 py-2 text-right font-mono ${(h.lastNight ?? 0) > 0 ? "text-emerald-400" : (h.lastNight ?? 0) < 0 ? "text-red-400" : "text-white/40"}`}>
                      {h.lastNight === null ? "—" : formatPct(h.lastNight)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-white/70">
                      {(() => {
                        const g = h.team ? nextGame(upcoming, h.team) : null;
                        return g && h.team ? `${dayLabel(g.date, today)} ${matchup(g, h.team)} · ${tipTime(g.startTime)}` : "—";
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{h.team ? gamesWithin(upcoming, h.team, today) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <PriceChart points={chartPoints} title="Net worth by game night" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Recent trades</h2>
        {(trades ?? []).length === 0 ? (
          <p className="text-sm text-white/40">No trades yet.</p>
        ) : (
          <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
            {trades!.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                <span className={`w-10 text-xs font-semibold uppercase ${t.side === "buy" ? "text-emerald-400" : "text-red-400"}`}>{t.side}</span>
                <Link href={`/players/${t.ticker}`} className="font-mono font-semibold text-emerald-300">{t.ticker}</Link>
                <span className="text-white/70">{t.shares} @ {formatMoney(t.price)}</span>
                <span className="ml-auto font-mono">{formatMoney(t.shares * Number(t.price))}</span>
                <time className="w-36 text-right text-xs text-white/40" dateTime={t.created_at}>
                  {new Date(t.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" })}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
