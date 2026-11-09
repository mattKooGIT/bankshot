"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { ROOM_COOKIE } from "@/lib/rooms";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/forms";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function setRoomCookie(roomId: string) {
  (await cookies()).set(ROOM_COOKIE, roomId, {
    httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
}

/** Switch the room you're trading in. Membership is re-checked on every read (getCurrentRoom). */
export async function switchRoom(roomId: string): Promise<void> {
  if (!UUID.test(roomId)) return;
  await setRoomCookie(roomId);
  refresh();
}

export async function createRoom(_prev: FormState, fd: FormData): Promise<FormState> {
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").replace(/[$,\s]/g, "");
    return v === "" ? null : Number(v);
  };
  const ends = String(fd.get("ends_at") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_name: String(fd.get("name") ?? ""),
    p_starting_cash: num("starting_cash"),
    p_member_cap: num("member_cap"),
    p_ends_at: ends || null,
  });
  if (error) return { ok: false, message: error.message };
  const { id } = data as { id: string };
  await setRoomCookie(id); // you start trading in the room you just made
  redirect(`/rooms/${id}`);
}

export async function removeMember(roomId: string, userId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_member", { p_room: roomId, p_user: userId });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "Removed." };
}

export async function resetInvite(roomId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("reset_invite", { p_room: roomId });
  if (error) return { ok: false, message: error.message };
  refresh();
  return { ok: true, message: "New invite link created. The old one no longer works." };
}
