"use client";

import Link from "next/link";
import { useLive } from "@/lib/useLive";

/** "Live · N" while games are in progress; nothing otherwise. */
export function LiveBadge() {
  const { data } = useLive();
  const live = data?.games.filter((g) => g.state === "in").length ?? 0;
  if (live === 0) return null;
  return (
    <Link href="/scores" className="flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 px-2.5 py-0.5 text-xs font-medium text-red-300 hover:border-red-500/60">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
      Live · {live}
    </Link>
  );
}
