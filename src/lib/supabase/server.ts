import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers.
 * Create a new one per request; never share it.
 */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Server Components can't set cookies; proxy.ts refreshes the session instead.
          }
        },
      },
    },
  );
}

/**
 * Only allow same-site relative paths as post-login destinations (prevents open redirects).
 * Rejects backslashes and control characters anywhere: browsers strip tabs/newlines, so
 * "/\t/evil.com" would otherwise become the protocol-relative "//evil.com".
 */
export function safeNext(next: string | null | undefined, fallback = "/") {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  return next;
}

/** Where to go after signing in: a safe `next`, otherwise the market (the app, not the landing page). */
export function postLoginPath(next: string | null | undefined): string {
  return safeNext(next, "/market");
}
