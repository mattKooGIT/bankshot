import { headers } from "next/headers";

/** This site's origin (e.g. http://localhost:3000) for links in emails and invites. */
export async function siteOrigin(): Promise<string> {
  const h = await headers();
  return h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

/** Where Supabase sends people back after an email link or OAuth sign-in. */
export async function authCallbackUrl(next: string): Promise<string> {
  return `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}`;
}
