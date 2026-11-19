import { NextResponse, type NextRequest } from "next/server";
import { createClient, safeNext } from "@/lib/supabase/server";

// POST only, so a link or prefetch can't sign someone out. ?next= picks a same-site destination.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/");
  return NextResponse.redirect(new URL(next, request.url), { status: 303 });
}
