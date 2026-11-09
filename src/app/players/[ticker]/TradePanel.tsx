import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRoom, isRoomEnded } from "@/lib/rooms";
import { TradeForm } from "./TradeForm";

// Per-user: reads the session and current room, so it renders at request time inside a Suspense boundary.
export async function TradePanel({ ticker, price, injured }: { ticker: string; price: number; injured: boolean }) {
  const current = await getCurrentRoom();
  if (!current) {
    return (
      <div className="space-y-3 text-sm">
        <p className="text-white/60">Sign in to trade {ticker}. New accounts start with $10,000.</p>
        <Link href={`/login?next=/players/${ticker}`} className="block rounded-lg bg-emerald-500 px-4 py-2.5 text-center font-medium text-black hover:bg-emerald-400">
          Sign in to trade
        </Link>
      </div>
    );
  }

  const { room, userId, cash } = current;
  if (isRoomEnded(room)) {
    return (
      <p className="text-sm text-white/60">
        <span className="text-white">{room.name}</span>: This room has ended. Switch rooms in the header to keep trading.
      </p>
    );
  }

  const supabase = await createClient();
  const { data: holding } = await supabase.from("holdings").select("shares")
    .eq("room_id", room.id).eq("user_id", userId).eq("ticker", ticker).maybeSingle();

  return (
    <TradeForm roomId={room.id} roomName={room.name} ticker={ticker} price={price} injured={injured}
      cash={cash} owned={holding?.shares ?? 0} />
  );
}
