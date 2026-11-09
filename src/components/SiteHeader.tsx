import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";

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
          <Link href="/portfolio" className="hover:text-white">Portfolio</Link>
          <Link href="/leaderboard" className="hover:text-white">Leaderboard</Link>
        </div>
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
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (!userId) {
    return (
      <Link href="/login" className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-black hover:bg-emerald-400">
        Sign in
      </Link>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("username, cash").eq("id", userId).maybeSingle();
  return (
    <>
      {profile && (
        <span className="text-white/70">
          {profile.username} · <span className="font-mono text-white">{formatMoney(profile.cash)}</span> cash
        </span>
      )}
      <form action="/auth/signout" method="post">
        <button className="text-white/60 hover:text-white">Sign out</button>
      </form>
    </>
  );
}
