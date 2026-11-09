import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { RecapBanner } from "@/components/RecapBanner";
import { RecapView } from "@/components/RecapView";
import { NightCard } from "@/app/rooms/[id]/Activity";
import { nightEventFixture, recapFixture, topsFixture } from "@/lib/__fixtures__/recap";

// Development-only preview of the recap and nightly results with made-up data.
export default function RecapPreviewPage() {
  return <Suspense><RecapPreview /></Suspense>;
}

async function RecapPreview() {
  await connection(); // read the env at request time, not build time
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_DEV_PREVIEW !== "1") notFound();

  return (
    <main>
      <RecapBanner recap={recapFixture} currentRoomId="fnh" alwaysShow />
      <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Development preview with made-up data. Real recaps appear after each game night.
        </p>
        <section>
          <h1 className="text-2xl font-semibold">Last night</h1>
          <div className="mt-6"><RecapView recap={recapFixture} tops={topsFixture} me="you" /></div>
        </section>
        <section>
          <h2 className="mb-3 text-sm font-medium text-white/60">Nightly results post in a room&apos;s Activity feed</h2>
          <div className="rounded-lg border border-white/10 px-4 py-3 text-sm"><NightCard ev={nightEventFixture} me="you" /></div>
        </section>
      </div>
    </main>
  );
}
