import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

const primary = "rounded-lg bg-emerald-500 px-6 py-3 font-semibold text-black hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300";
const secondary = "rounded-lg border border-white/25 px-6 py-3 font-semibold hover:border-white/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** Signed out: start a league or browse. Signed in: straight to the market or your rooms. */
export async function HeroActions() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  return (
    <div className="mt-9 flex flex-wrap gap-3">
      {signedIn ? (
        <>
          <Link href="/market" className={primary}>Go to the market</Link>
          <Link href="/rooms" className={secondary}>Your rooms</Link>
        </>
      ) : (
        <>
          <Link href="/login?next=/rooms" className={primary}>Start a league with friends</Link>
          <Link href="/market" className={secondary}>Go to the market</Link>
        </>
      )}
    </div>
  );
}
