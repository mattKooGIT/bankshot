"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { ROOM_COOKIE } from "@/lib/rooms";

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
