import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client: bypasses RLS. Server-only (sync job). The key has no
 * NEXT_PUBLIC_ prefix, so Next.js never ships it to the browser.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") throw new Error("createAdminClient is server-only");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
