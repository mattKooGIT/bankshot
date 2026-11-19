// "Try the demo" helpers. isGuest is pure (safe anywhere); ensureDemoBots needs the service-role client.
import type { SupabaseClient } from "@supabase/supabase-js";

/** The permanent rivals in every guest's Demo League (seed_demo finds them by these emails). */
export const DEMO_BOTS = ["bucket_getter", "fade_master", "sixth_man"] as const;
const botEmail = (name: string) => `${name}@bankshot.invalid`;

/** True for Supabase anonymous sign-ins: the demo's guest accounts. */
export function isGuest(claims: { is_anonymous?: boolean } | null | undefined): boolean {
  return claims?.is_anonymous === true;
}

let ready: Promise<void> | null = null;

/** Creates the 3 hidden bot accounts if they're missing. Once per server process. */
export function ensureDemoBots(admin: SupabaseClient): Promise<void> {
  ready ??= (async () => {
    for (const name of DEMO_BOTS) {
      const created = await admin.auth.admin.createUser({ email: botEmail(name), email_confirm: true });
      if (created.error && !/already/i.test(created.error.message)) throw created.error;
      // Look the bot up by email either way (createUser returns no user when it already exists).
      const id = created.data.user?.id ?? (await findUserId(admin, botEmail(name)));
      const upd = await admin.from("profiles").update({ username: name, hidden: true }).eq("id", id);
      if (upd.error) throw upd.error;
    }
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

async function findUserId(admin: SupabaseClient, email: string): Promise<string> {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === email);
    if (hit) return hit.id;
    if (data.users.length < 1000) throw new Error(`Demo bot ${email} not found.`);
  }
}
