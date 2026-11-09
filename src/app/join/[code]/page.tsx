import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { getMyRooms } from "@/lib/rooms";
import { JoinButton } from "./JoinButton";

export const metadata: Metadata = { title: "Join a room · Courtside Exchange" };

export default function JoinPage({ params }: PageProps<"/join/[code]">) {
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white/5" />}>
        <Invite params={params} />
      </Suspense>
    </main>
  );
}

type Preview = {
  id: string; name: string; owner_username: string | null; member_count: number;
  member_cap: number | null; starting_cash: number; ends_at: string | null; ended: boolean;
};

async function Invite({ params }: Pick<PageProps<"/join/[code]">, "params">) {
  const { code } = await params;
  const supabase = await createClient();
  const [{ data }, { data: auth }] = await Promise.all([
    supabase.rpc("room_preview", { p_invite_code: code }),
    supabase.auth.getClaims(),
  ]);
  const room = data as Preview | null;

  if (!room) {
    return <Notice title="Invite link not valid">This invite link is no longer valid. Ask the owner for a new one.</Notice>;
  }

  const signedIn = Boolean(auth?.claims?.sub);
  const isMember = signedIn && (await getMyRooms()).some((r) => r.id === room.id);
  const full = room.member_cap !== null && room.member_count >= room.member_cap;

  return (
    <div className="space-y-6 rounded-xl border border-white/10 bg-white/[0.02] p-6">
      <div>
        <p className="text-sm text-white/50">{room.owner_username ? `${room.owner_username} invited you to` : "You're invited to"}</p>
        <h1 className="text-2xl font-semibold">{room.name}</h1>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-white/50">Starting cash</dt><dd className="font-mono">{formatMoney(room.starting_cash)}</dd></div>
        <div><dt className="text-white/50">Members</dt><dd>{room.member_cap ? `${room.member_count} of ${room.member_cap}` : room.member_count}</dd></div>
        <div className="col-span-2"><dt className="text-white/50">Ends</dt><dd>{room.ends_at ? `${room.ends_at} (US Eastern)` : "No end date"}</dd></div>
      </dl>
      <p className="text-xs text-white/40">You get a separate bankroll for this room. Your other rooms aren&apos;t affected.</p>

      {isMember ? (
        <p className="text-sm">You&apos;re already in this room. <Link href={`/rooms/${room.id}`} className="text-emerald-300 underline">Go to {room.name}</Link></p>
      ) : room.ended ? (
        <p className="text-sm text-red-300">This room has ended.</p>
      ) : full ? (
        <p className="text-sm text-red-300">This room is full.</p>
      ) : !signedIn ? (
        <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`}
          className="block rounded-lg bg-emerald-500 px-4 py-2.5 text-center font-medium text-black hover:bg-emerald-400">
          Sign in to join
        </Link>
      ) : (
        <JoinButton code={code} roomName={room.name} />
      )}
    </div>
  );
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 p-6 text-center">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-white/60">{children}</p>
    </div>
  );
}
