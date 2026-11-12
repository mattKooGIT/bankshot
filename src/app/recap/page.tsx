import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentRoom } from "@/lib/rooms";
import type { Recap } from "@/lib/recap";
import { RecapView, type TopRow } from "@/components/RecapView";

export const metadata: Metadata = { title: "Last night · Courtside Exchange" };

export default function RecapPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Last night</h1>
      <Suspense fallback={<div className="mt-6 h-64 animate-pulse rounded-xl bg-white/5" />}>
        <RecapBody />
      </Suspense>
    </main>
  );
}

async function RecapBody() {
  const current = await getCurrentRoom();
  if (!current) {
    return (
      <p className="mt-6 text-white/60">
        <Link href="/login?next=/recap" className="text-emerald-300 underline">Sign in</Link> to see how your players did.
      </p>
    );
  }
  const supabase = await createClient();
  const [{ data }, { data: me }] = await Promise.all([
    supabase.rpc("my_recap", { p_room: current.room.id }),
    supabase.from("profiles").select("username").eq("id", current.userId).single(),
  ]);
  const recap = data as Recap | null;
  if (!recap || recap.rooms.length === 0) {
    return <p className="mt-6 text-white/60">Your first recap appears after the next game night.</p>;
  }
  // Each private room's top 3 (prices don't change between game nights, so this is last night's order).
  const tops: Record<string, TopRow[]> = {};
  await Promise.all(recap.rooms.filter((r) => !r.is_public).map(async (r) => {
    const { data: rows } = await supabase.rpc("leaderboard", { p_room: r.room_id, p_limit: 3 });
    tops[r.room_id] = ((rows ?? []) as TopRow[]).map((x) => ({ ...x, net_worth: Number(x.net_worth) }));
  }));
  return <div className="mt-6"><RecapView recap={recap} tops={tops} me={me?.username ?? ""} /></div>;
}
