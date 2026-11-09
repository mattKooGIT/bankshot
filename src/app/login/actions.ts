"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, safeNext } from "@/lib/supabase/server";

async function callbackUrl(next: string) {
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export type LoginState = { error?: string; sent?: string };

/** Email magic link: works for both new and returning users. */
export async function signInWithEmail(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();
  const next = safeNext(String(formData.get("next") ?? ""));
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a valid email address." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: await callbackUrl(next) },
  });
  if (error) return { error: error.message };
  return { sent: email };
}

export async function signInWithGoogle(formData: FormData) {
  const next = safeNext(String(formData.get("next") ?? ""));
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: await callbackUrl(next) },
  });
  if (error || !data.url) redirect(`/login?error=${encodeURIComponent(error?.message ?? "Google sign-in failed.")}`);
  redirect(data.url);
}
