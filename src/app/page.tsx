import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Big_Shoulders } from "next/font/google";
import { getLatestNight, getMarket } from "@/lib/market";
import { getMarketIndexHistory, marketIndex, topMovers } from "@/lib/landing";
import { formatMoney, formatPct } from "@/lib/format";
import { TickerTape } from "@/components/landing/TickerTape";
import { HeroChart } from "@/components/landing/HeroChart";
import { LiveBadge } from "@/components/LiveBadge";
import { HeroActions } from "./HeroActions";

// Arena-signage display face for the headline and step numbers only.
const display = Big_Shoulders({ subsets: ["latin"], weight: ["800", "900"] });

export const metadata: Metadata = {
  title: "Bankshot: the stock market, but for the NBA",
  description: "Buy and sell players with paper money. Prices move every night on real box scores. Beat your friends.",
};

const HAS_DEMO = existsSync(join(process.cwd(), "public", "demo.webm"));

const STEPS = [
  { title: "Get $10,000", body: "Every account starts with paper money. No real money, ever." },
  { title: "Buy players like stocks", body: "Every rotation player has a ticker and a price. Buy the ones you believe in." },
  { title: "Prices move every night", body: "Luka drops 45, his price jumps. Injuries and what other traders buy count too." },
  { title: "Climb the leaderboard", body: "Beat your friends in a private room, or everyone in the Public room." },
];

export default async function Home() {
  const [players, history, latest] = await Promise.all([getMarket(), getMarketIndexHistory(), getLatestNight()]);
  const tape = players.slice(0, 30).map((p) => ({ ticker: p.ticker, price: p.price, change: p.last_move?.total ?? null }));
  const movers = topMovers(players, 3);
  const hasMovers = movers.up.length + movers.down.length > 0;

  return (
    <main>
      {/* Hero: the one loud thing on the page */}
      <section className="relative isolate flex min-h-[calc(100svh-3.25rem)] flex-col overflow-hidden">
        <HeroChart points={marketIndex(history)} />
        {/* Keep the copy on clean background: fade the chart out behind the left column. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-[#0b0d10] via-[#0b0d10]/80 to-transparent md:via-[#0b0d10]/60" />
        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-16">
          <h1 className={`${display.className} max-w-4xl text-[clamp(3.25rem,10vw,8.5rem)] font-black uppercase leading-[0.88] tracking-[-0.01em]`}>
            The stock market,<br />but for the NBA.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-white/70">
            Buy and sell players with paper money. Prices move every night on real box scores. Beat your friends.
          </p>
          <Suspense fallback={<div className="mt-9 h-12" />}>
            <HeroActions />
          </Suspense>
        </div>
        <div className="relative">
          <TickerTape items={tape} />
        </div>
      </section>

      {/* How it works: a real sequence, so it's numbered */}
      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="text-2xl font-semibold">How it works</h2>
        <ol className="mt-10 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <span className={`${display.className} block text-6xl font-black leading-none text-[#d9a05b]`}>{i + 1}</span>
              <h3 className="mt-3 font-semibold">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-white/60">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {HAS_DEMO && (
        <section className="mx-auto max-w-5xl px-4 pb-20">
          <h2 className="text-2xl font-semibold">See it in action</h2>
          <p className="mt-2 text-white/60">A minute on the real site: the market, a trade, live scores, and starting a room.</p>
          <video className="mt-6 w-full rounded-lg border border-white/10 bg-black" src="/demo.webm" poster="/demo-poster.png"
            muted loop playsInline controls preload="none" />
        </section>
      )}

      {/* Friends and game nights, side by side */}
      <section className="border-y border-white/10">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Play with friends</h2>
            <p className="mt-3 leading-relaxed text-white/70">
              Start a room, send the invite link, and everyone gets their own bankroll. Pick the starting cash, cap the
              group, and set an end date. When it ends, the standings lock and the winner is final.
            </p>
            <Link href="/rooms" className="mt-6 inline-block rounded-lg border border-white/20 px-4 py-2 font-medium hover:border-white/50">
              Create a room
            </Link>
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-semibold">Live on game nights</h2>
              <LiveBadge />
            </div>
            <p className="mt-3 leading-relaxed text-white/70">
              Follow every game as it happens, open any box score, and watch the players you own pile up fantasy points
              against what they&apos;re expected to score.
            </p>
            <Link href="/scores" className="mt-6 inline-block rounded-lg border border-white/20 px-4 py-2 font-medium hover:border-white/50">
              See tonight&apos;s games
            </Link>
          </div>
        </div>
      </section>

      {hasMovers && (
        <section className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="text-2xl font-semibold">Today&apos;s movers</h2>
          <p className="mt-2 text-white/60">After game night {latest?.night}{latest?.game_date ? ` (${latest.game_date})` : ""}.</p>
          <div className="mt-8 grid gap-10 md:grid-cols-2">
            {([["Rising", movers.up], ["Falling", movers.down]] as const).map(([label, list]) => (
              <div key={label}>
                <h3 className="mb-3 text-sm font-medium text-white/60">{label}</h3>
                <ul className="divide-y divide-white/10 border-y border-white/10">
                  {list.map((p) => (
                    <li key={p.ticker}>
                      <Link href={`/players/${p.ticker}`} className="flex items-baseline gap-4 py-3 hover:bg-white/[0.03]">
                        <span className="w-24 font-semibold text-emerald-300">{p.ticker}</span>
                        <span className="flex-1 text-white/70">{p.name}</span>
                        <span className="tabular-nums">{formatMoney(p.price)}</span>
                        <span className={`w-20 text-right tabular-nums ${p.last_move!.total > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {formatPct(p.last_move!.total)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap gap-x-8 gap-y-2 px-4 py-8 text-sm text-white/50">
          <p>Paper trading only. No real money.</p>
          <p>Not affiliated with the NBA or its teams.</p>
        </div>
      </footer>
    </main>
  );
}
