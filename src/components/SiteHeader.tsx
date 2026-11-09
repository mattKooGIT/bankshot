import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { getCurrentRoom, getMyRooms } from "@/lib/rooms";
import { RoomSwitcher } from "./RoomSwitcher";
import { LiveBadge } from "./LiveBadge";

// The nav is static (prerendered); only the account area depends on cookies,
// so it streams in inside its own Suspense boundary.
export function SiteHeader() {
  return (
    <header className="border-b border-white/10">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 text-sm">
        <Link href="/" className="font-semibold tracking-tight">
          Courtside<span className="text-emerald-400">Exchange</span>
        </Link>
        <div className="flex gap-4 text-white/70">
          <Link href="/market" className="hover:text-white">Market</Link>
          <Link href="/scores" className="hover:text-white">Scores</Link>
          <Link href="/portfolio" className="hover:text-white">Portfolio</Link>
          <Link href="/leaderboard" className="hover:text-white">Leaderboard</Link>
          <Link href="/rooms" className="hover:text-white">Rooms</Link>
        </div>
        <LiveBadge />
        <div className="ml-auto flex items-center gap-4">
          <Suspense fallback={<span className="h-5 w-32 animate-pulse rounded bg-white/5" />}>
            <AccountArea />
          </Suspense>
        </div>
      </nav>
    </header>
  );
}

async function AccountArea() {
  const current = await getCurrentRoom();
  if (!current) {
    return (
      <Link href="/login" className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-black hover:bg-emerald-400">
        Sign in
      </Link>
    );
  }

  const supabase = await createClient();
  const [rooms, { data: profile }] = await Promise.all([
    getMyRooms(),
    supabase.from("profiles").select("username").eq("id", current.userId).maybeSingle(),
  ]);
  return (
    <>
      <RoomSwitcher rooms={rooms.map((r) => ({ id: r.id, name: r.name }))} currentId={current.room.id} />
      <span className="text-white/70">
        <span className="font-mono text-white">{formatMoney(current.cash)}</span> cash
      </span>
      <Link href="/settings" className="text-white/60 hover:text-white">{profile?.username ?? "Settings"}</Link>
      <form action="/auth/signout" method="post">
        <button className="text-white/60 hover:text-white">Sign out</button>
      </form>
    </>
  );
}
