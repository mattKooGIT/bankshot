import { connection } from "next/server";
import { getLiveData } from "@/lib/live-server";

// Always per request; the ESPN fetch inside getLiveData() is what's cached (15s).
export async function GET() {
  await connection();
  return Response.json(await getLiveData(), { headers: { "Cache-Control": "no-store" } });
}
