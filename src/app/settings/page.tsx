import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";
import { EmailForm, UsernameForm } from "./SettingsForms";

export const metadata: Metadata = { title: "Settings · Courtside Exchange" };

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-white/5" />}>
        <Settings searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const { notice } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="rounded-xl border border-white/10 p-8 text-center">
        <p className="text-white/60">Sign in to change your username or email.</p>
        <Link href="/login?next=/settings" className="mt-4 inline-block rounded-lg bg-emerald-500 px-5 py-2.5 font-medium text-black">
          Sign in
        </Link>
      </div>
    );
  }

  const { data: profile } = await supabase.from("profiles").select("username").eq("id", user.id).single();
  const google = user.identities?.some((i) => i.provider === "google") ?? false;
  const section = "space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-5";

  return (
    <div className="space-y-6">
      {typeof notice === "string" && (
        <p role="status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">{notice}</p>
      )}
      <section className={section}><UsernameForm current={profile?.username ?? ""} /></section>
      <section className={section}><EmailForm current={user.email ?? ""} /></section>
      <section className={section}>
        <h2 className="text-sm text-white/70">Sign-in methods</h2>
        <ul className="text-sm">
          <li>Email link</li>
          {google && <li>Google</li>}
        </ul>
        <p className="text-xs text-white/40">There are no passwords. You sign in with a link sent to your email{google ? " or with Google" : ""}.</p>
      </section>
    </div>
  );
}
