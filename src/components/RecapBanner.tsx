"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { bannerText, shouldShowBanner, type Recap } from "@/lib/recap";

const KEY = "recap-dismissed-night";
const EVENT = "recap-dismissed";

// The dismissed night lives in this browser's localStorage; the server renders nothing.
function subscribe(fn: () => void) {
  window.addEventListener("storage", fn);
  window.addEventListener(EVENT, fn);
  return () => { window.removeEventListener("storage", fn); window.removeEventListener(EVENT, fn); };
}
function readDismissed(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

export function RecapBanner({ recap, currentRoomId, alwaysShow = false }: { recap: Recap | null; currentRoomId: string; alwaysShow?: boolean }) {
  const stored = useSyncExternalStore(subscribe, readDismissed, () => "server");
  if (!recap || stored === "server") return null;
  const dismissed = stored ? Number(stored) : null;
  if (!alwaysShow && !shouldShowBanner(recap, dismissed)) return null;

  const dismiss = () => {
    try { localStorage.setItem(KEY, String(recap.night)); } catch {}
    window.dispatchEvent(new Event(EVENT));
  };
  return (
    <div className="border-b border-[#d9a05b]/25 bg-[#d9a05b]/10">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 text-sm">
        <p className="flex-1">{bannerText(recap, currentRoomId)}</p>
        <Link href="/recap" className="whitespace-nowrap font-medium text-[#e8b97a] hover:underline">See recap</Link>
        {!alwaysShow && <button type="button" onClick={dismiss} aria-label="Dismiss recap" className="text-white/50 hover:text-white">×</button>}
      </div>
    </div>
  );
}
