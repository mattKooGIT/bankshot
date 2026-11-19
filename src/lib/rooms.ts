import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { easternToday } from "@/lib/dates";

export const PUBLIC_ROOM_ID = "00000000-0000-4000-8000-000000000001";
export const ROOM_COOKIE = "room";
export const ROOM_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 } as const;

export type Room = {
  id: string;
  name: string;
  is_public: boolean;
  owner_id: string | null;
  starting_cash: number;
  member_cap: number | null;
  ends_at: string | null;
  finalized_at: string | null;
};

// invite_code is deliberately not selectable (owner-only via room_invite()).
export const ROOM_COLUMNS = "id,name,is_public,owner_id,starting_cash,member_cap,ends_at,finalized_at";

/** Open through its end date (US Eastern); ended once that date passes or it's finalized. */
export function isRoomEnded(room: Pick<Room, "ends_at" | "finalized_at">, today = easternToday()): boolean {
  return room.finalized_at !== null || (room.ends_at !== null && room.ends_at < today);
}

type Membership = { room: Room; cash: number };

/** The cookie's room if you're a member of it; otherwise your Public membership. */
export function pickCurrentRoom<M extends { room: { id: string; is_public: boolean } }>(
  memberships: M[], wanted: string | undefined,
): M | undefined {
  return memberships.find((m) => m.room.id === wanted) ?? memberships.find((m) => m.room.is_public);
}

/** The signed-in user's memberships, once per request. Null when signed out. */
const loadMemberships = cache(async (): Promise<{ userId: string; memberships: Membership[] } | null> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  const userId = auth?.claims?.sub;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("room_members").select(`cash, rooms(${ROOM_COLUMNS})`).eq("user_id", userId);
  if (error) throw new Error(`Couldn't load your rooms: ${error.message}`);

  const memberships = (data ?? []).flatMap((row) => {
    const r = row.rooms as unknown as Room | null;
    return r ? [{ room: { ...r, starting_cash: Number(r.starting_cash) }, cash: Number(row.cash) }] : [];
  });
  return { userId, memberships };
});

/** Your rooms: Public first, then by name. */
export async function getMyRooms(): Promise<Room[]> {
  const loaded = await loadMemberships();
  return (loaded?.memberships ?? [])
    .map((m) => m.room)
    .sort((a, b) => Number(b.is_public) - Number(a.is_public) || a.name.localeCompare(b.name));
}

/**
 * The room you're trading in: the `room` cookie if you're a member of it, otherwise
 * Public (covers a stale cookie after removal, or garbage). Null when signed out.
 */
export async function getCurrentRoom(): Promise<{ userId: string; room: Room; cash: number } | null> {
  const loaded = await loadMemberships();
  if (!loaded) return null;
  const wanted = (await cookies()).get(ROOM_COOKIE)?.value;
  const pick = pickCurrentRoom(loaded.memberships, wanted);
  if (!pick) throw new Error("You aren't in the Public room. Run migration 0006.");
  return { userId: loaded.userId, room: pick.room, cash: pick.cash };
}

/** The Public room's details, for signed-out views. */
export async function getPublicRoom(): Promise<Room> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("rooms").select(ROOM_COLUMNS).eq("id", PUBLIC_ROOM_ID).single();
  if (error) throw new Error(`Couldn't load the Public room: ${error.message}`);
  return { ...(data as unknown as Room), starting_cash: Number(data.starting_cash) };
}
