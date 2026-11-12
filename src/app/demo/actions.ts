"use server";

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDemoBots, isGuest } from "@/lib/demo";
import { ROOM_COOKIE, ROOM_COOKIE_OPTIONS } from "@/lib/rooms";

export type DemoResult = { goto: string } | { error: string };

const FAILED = "The demo couldn't start. Try again in a minute.";
const BUSY = "The demo is busy right now. Try again in a few minutes.";

/**
 * Builds (or reuses) the signed-in guest's Demo League and makes it the current room.
 * The browser signs in anonymously first (so Supabase rate-limits each visitor's own IP).
 */
export async function seedDemo(): Promise<DemoResult> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return { error: FAILED };
  // A real account is signed in: never touch it, just go to their rooms.
  if (!isGuest(claims)) return { goto: "/rooms" };

  try {
    const admin = createAdminClient();
    await ensureDemoBots(admin);
    const seeded = await admin.rpc("seed_demo", { p_guest: claims.sub });
    if (seeded.error) throw seeded.error;
    const room = seeded.data as string;
    (await cookies()).set(ROOM_COOKIE, room, ROOM_COOKIE_OPTIONS);
    return { goto: `/rooms/${room}` };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`The demo couldn't start: ${message}`);
    return { error: message === BUSY ? BUSY : FAILED };
  }
}
