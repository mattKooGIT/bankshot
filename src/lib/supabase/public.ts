import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Cookie-free client for public market data (players, prices, games). Because it
 * never reads the request, its results can be cached with "use cache".
 */
export function createPublicClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
