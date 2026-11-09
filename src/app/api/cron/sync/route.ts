import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { syncNights } from "@/lib/sync";

// Nightly job (e.g. Vercel Cron, ~10:00 UTC). Requires `Authorization: Bearer $CRON_SECRET`.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = await syncNights(undefined, () => {});
    // Prices moved: the next visitor gets fresh data, never stale prices.
    if (results.some((r) => r.result === "applied")) revalidateTag("market", { expire: 0 });
    return NextResponse.json({ results });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
