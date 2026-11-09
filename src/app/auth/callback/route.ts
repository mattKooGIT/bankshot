import { NextResponse, type NextRequest } from "next/server";
import { createClient, safeNext } from "@/lib/supabase/server";
import { callbackDestination } from "@/lib/auth-callback";

// Google OAuth and email links land here with a one-time `code`, which we exchange
// for a session cookie. Email-change confirmations may arrive with only a `message`.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  let exchangeOk = false;
  if (code) {
    const supabase = await createClient();
    exchangeOk = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }
  const to = callbackDestination({ next, hadCode: Boolean(code), exchangeOk, message: searchParams.get("message") });
  return NextResponse.redirect(`${origin}${to}`);
}
