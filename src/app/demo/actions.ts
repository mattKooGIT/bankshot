"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureDemoBots, isGuest } from "@/lib/demo";
import { ROOM_COOKIE, ROOM_COOKIE_OPTIONS } from "@/lib/rooms";

/** "Try the demo": sign in as a guest (or reuse this browser's guest), build the Demo League, go there. */
export async function startDemo(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  // A real account is already signed in: never swap it for a guest.
  if (claims?.sub && !isGuest(claims)) redirect("/rooms");

  let room: string | null = null;
  let signedInHere = false;
  try {
    let userId = claims?.sub;
    if (!userId) {
      const anon = await supabase.auth.signInAnonymously();
      if (anon.error || !anon.data.user) throw anon.error ?? new Error("No user from anonymous sign-in.");
      signedInHere = true;
      userId = anon.data.user.id;
    }
    const admin = createAdminClient();
    await ensureDemoBots(admin);
    const seeded = await admin.rpc("seed_demo", { p_guest: userId });
    if (seeded.error) throw seeded.error;
    room = seeded.data as string;
  } catch (e) {
    console.warn(`The demo couldn't start: ${e instanceof Error ? e.message : String(e)}`);
    if (signedInHere) await supabase.auth.signOut();
  }

  if (!room) redirect("/login?error=demo");
  (await cookies()).set(ROOM_COOKIE, room, ROOM_COOKIE_OPTIONS);
  redirect(`/rooms/${room}`);
}
