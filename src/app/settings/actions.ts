"use server";

import { refresh } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { authCallbackUrl } from "@/lib/origin";
import type { FormState } from "@/lib/forms";

/** set_username() enforces the format and case-insensitive uniqueness. */
export async function updateUsername(_prev: FormState, fd: FormData): Promise<FormState> {
  const username = String(fd.get("username") ?? "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_username", { p_username: username });
  if (error) return { ok: false, message: error.message };
  refresh(); // header and leaderboards show the new name
  return { ok: true, message: `You're now ${data}.` };
}

/** Supabase's secure email change: confirmation links go to both the old and new address. */
export async function updateEmail(_prev: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Enter a valid email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: await authCallbackUrl("/settings") });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "Check both your old and new inbox. The change takes effect after you confirm from both." };
}
