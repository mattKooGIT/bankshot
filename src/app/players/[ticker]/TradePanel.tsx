import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { TradeForm } from "./TradeForm";

// Per-user: reads the session, so it renders at request time inside a Suspense boundary.
export async function TradePanel({ ticker, price, injured }: { ticker: string; price: number; injured: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-white/60">Sign in to trade {ticker}. New accounts start with $10,000.</p>
        <Link href={`/login?next=/players/${ticker}`} className="block rounded-lg bg-emerald-500 px-4 py-2.5 text-center font-medium text-black hover:bg-emerald-400">
          Sign in to trade
        </Link>
      </div>
    );
  }

  const [{ data: profile }, { data: holding }] = await Promise.all([
    supabase.from("profiles").select("cash").eq("id", userId).single(),
    supabase.from("holdings").select("shares").eq("user_id", userId).eq("ticker", ticker).maybeSingle(),
  ]);

  return (
    <TradeForm ticker={ticker} price={price} injured={injured}
      cash={Number(profile?.cash ?? 0)} owned={holding?.shares ?? 0} />
  );
}
