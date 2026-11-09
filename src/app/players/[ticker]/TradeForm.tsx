"use client";

import { useActionState, useState } from "react";
import { trade, type TradeState } from "./actions";
import { formatMoney } from "@/lib/format";

export function TradeForm({ ticker, price, cash, owned, injured }: {
  ticker: string; price: number; cash: number; owned: number; injured: boolean;
}) {
  const [state, action, pending] = useActionState<TradeState, FormData>(trade, {});
  const [side, setSide] = useState<"buy" | "sell">(injured && owned > 0 ? "sell" : "buy");
  const [shares, setShares] = useState("1");

  const n = Number(shares);
  const valid = Number.isInteger(n) && n > 0;
  const maxBuy = Math.floor(cash / price);
  const max = side === "buy" ? maxBuy : owned;
  const total = valid ? n * price : 0;
  const blocked = side === "buy" ? injured || n > maxBuy : n > owned;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="ticker" value={ticker} />
      <input type="hidden" name="side" value={side} />

      <div className="grid grid-cols-2 rounded-lg border border-white/15 p-0.5 text-sm" role="group" aria-label="Order side">
        {(["buy", "sell"] as const).map((s) => (
          <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s}
            className={`rounded-md py-1.5 font-medium capitalize ${side === s ? (s === "buy" ? "bg-emerald-500 text-black" : "bg-red-500 text-black") : "text-white/60 hover:text-white"}`}>
            {s}
          </button>
        ))}
      </div>

      <div>
        <div className="mb-1 flex items-baseline justify-between text-sm">
          <label htmlFor="shares" className="text-white/70">Shares</label>
          <button type="button" onClick={() => setShares(String(Math.max(max, 0)))} className="text-xs text-white/50 hover:text-white">
            Max {max}
          </button>
        </div>
        <input id="shares" name="shares" inputMode="numeric" value={shares}
          onChange={(e) => setShares(e.target.value.replace(/\D/g, ""))}
          className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono outline-none focus:border-white/40" />
      </div>

      <dl className="space-y-1 text-sm">
        <div className="flex justify-between"><dt className="text-white/60">Price</dt><dd className="font-mono">{formatMoney(price)}</dd></div>
        <div className="flex justify-between"><dt className="text-white/60">Est. total</dt><dd className="font-mono">{formatMoney(total)}</dd></div>
        <div className="flex justify-between"><dt className="text-white/60">Cash</dt><dd className="font-mono">{formatMoney(cash)}</dd></div>
        <div className="flex justify-between"><dt className="text-white/60">You own</dt><dd className="font-mono">{owned}</dd></div>
      </dl>

      {side === "buy" && injured && <p className="text-sm text-red-300">Buying is paused while he&apos;s out. You can still sell.</p>}

      <button disabled={pending || !valid || blocked}
        className={`w-full rounded-lg px-4 py-2.5 font-medium text-black disabled:opacity-40 ${side === "buy" ? "bg-emerald-500 hover:bg-emerald-400" : "bg-red-500 hover:bg-red-400"}`}>
        {pending ? "Placing order…" : `${side === "buy" ? "Buy" : "Sell"} ${valid ? n : ""} ${ticker}`}
      </button>

      {state.message && (
        <p role="status" className={`text-sm ${state.ok ? "text-emerald-300" : "text-red-300"}`}>{state.message}</p>
      )}
      <p className="text-xs text-white/40">Orders fill at the current price. Prices update once per game night.</p>
    </form>
  );
}
