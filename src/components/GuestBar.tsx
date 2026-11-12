import { createClient } from "@/lib/supabase/server";
import { isGuest } from "@/lib/demo";

/** Shown only to demo guests, under the header. */
export async function GuestBar() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!isGuest(data?.claims)) return null;
  return (
    <div className="border-t border-amber-500/20 bg-amber-500/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm text-amber-100">
        <p>You&apos;re in a demo account. It resets in 24 hours.</p>
        <form action="/auth/signout?next=/login" method="post">
          <button className="font-semibold underline hover:text-white">Sign up</button>
        </form>
      </div>
    </div>
  );
}
