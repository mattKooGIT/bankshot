"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type TradeState = { ok?: boolean; message?: string };

/** Calls the execute_trade Postgres function, which does every check and money move atomically. */
export async function trade(_prev: TradeState, formData: FormData): Promise<TradeState> {
  const ticker = String(formData.get("ticker") ?? "");
  const side = String(formData.get("side") ?? "");
  const shares = Number(formData.get("shares"));
  if (!Number.isInteger(shares) || shares <= 0) return { ok: false, message: "Enter a whole number of shares." };
  if (side !== "buy" && side !== "sell") return { ok: false, message: "Choose buy or sell." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("execute_trade", { p_ticker: ticker, p_side: side, p_shares: shares });
  if (error) return { ok: false, message: error.message };

  refresh(); // re-render header cash and this page's holdings
  const r = data as { shares: number; price: number; total: number };
  return {
    ok: true,
    message: `${side === "buy" ? "Bought" : "Sold"} ${r.shares} ${ticker} at $${Number(r.price).toFixed(2)} ($${Number(r.total).toFixed(2)}).`,
  };
}
