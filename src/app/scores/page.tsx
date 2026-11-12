import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getMarket } from "@/lib/market";
import { getCurrentRoom } from "@/lib/rooms";
import { getLiveData } from "@/lib/live-server";
import { ScoresView, type MyHolding } from "./ScoresView";

export const metadata: Metadata = { title: "Scores · Bankshot" };

export default function ScoresPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Tonight</h1>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-white/5" />}>
        <Scores />
      </Suspense>
    </main>
  );
}

async function Scores() {
  // Live data must never be prerendered: it changes between build phases during games.
  await connection();
  const [initial, market, current] = await Promise.all([getLiveData(), getMarket(), getCurrentRoom()]);
  const tickerByEspnId = Object.fromEntries(market.filter((p) => p.espn_id).map((p) => [p.espn_id!, p.ticker]));

  let holdings: MyHolding[] | null = null;
  if (current) {
    const supabase = await createClient();
    const { data } = await supabase.from("holdings").select("ticker, shares")
      .eq("user_id", current.userId).eq("room_id", current.room.id);
    const byTicker = new Map(market.map((p) => [p.ticker, p]));
    holdings = (data ?? []).flatMap((h) => {
      const p = byTicker.get(h.ticker);
      return p?.espn_id ? [{
        ticker: p.ticker, name: p.name, espnId: p.espn_id, team: p.team ?? "",
        expectedFp: p.expected_fp, shares: h.shares, out: p.out_nights > 0,
      }] : [];
    });
  }

  return <ScoresView initial={initial} holdings={holdings} roomName={current?.room.name ?? null} tickerByEspnId={tickerByEspnId} />;
}
