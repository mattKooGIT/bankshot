import type { Metadata } from "next";
import { getLatestNight, getMarket } from "@/lib/market";
import { MarketTable } from "./MarketTable";

export const metadata: Metadata = { title: "Market · Courtside Exchange" };

export default async function MarketPage() {
  const [players, latest] = await Promise.all([getMarket(), getLatestNight()]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Market</h1>
        <p className="mt-1 text-sm text-white/60">
          {latest
            ? `Prices as of game night ${latest.night}${latest.game_date ? ` (${latest.game_date})` : ""}.`
            : "Opening prices. They move after the first game night is processed."}{" "}
          Prices move once per night on real box scores. Exp. FP = expected fantasy points per game.
        </p>
      </div>
      <MarketTable players={players} />
    </main>
  );
}
