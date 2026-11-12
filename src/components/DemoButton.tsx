"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { seedDemo } from "@/app/demo/actions";

/** One click: a guest account with a ready-made league. Errors show right under the button. */
export function DemoButton({ className }: { className: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    start(async () => {
      const supabase = createClient();
      const { data } = await supabase.auth.getSession();
      let signedInHere = false;
      if (!data.session) {
        // In the browser, so Supabase's anonymous sign-in limit applies per visitor.
        const anon = await supabase.auth.signInAnonymously();
        if (anon.error) { setError("The demo couldn't start. Try again in a minute."); return; }
        signedInHere = true;
      }
      const r = await seedDemo();
      if ("error" in r) {
        if (signedInHere) await supabase.auth.signOut();
        setError(r.error);
        return;
      }
      router.push(r.goto);
    });
  }

  return (
    <div>
      <button type="button" onClick={go} disabled={pending} className={`${className} disabled:opacity-60`}>
        {pending ? "Setting up your demo…" : "Try the demo — no sign-up"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
