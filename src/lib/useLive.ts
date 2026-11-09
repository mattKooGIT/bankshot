"use client";

import { useSyncExternalStore } from "react";
import type { LiveData } from "./live";
import { createLiveStore, type LiveSnapshot } from "./live-store";

let store: ReturnType<typeof createLiveStore> | null = null;

function getStore() {
  if (!store) {
    store = createLiveStore({
      fetchLive: async () => {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) throw new Error(`live ${res.status}`);
        return (await res.json()) as LiveData;
      },
      now: () => new Date(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
      isVisible: () => document.visibilityState === "visible",
    });
    const s = store;
    document.addEventListener("visibilitychange", () => s.onVisibilityChange());
  }
  return store;
}

const SERVER: LiveSnapshot = { data: null, error: false };

// Stable references: an inline subscribe would make React re-subscribe on every render,
// which (before the store's freshness guard) turned into a tight fetch loop.
const subscribe = (fn: () => void) => getStore().subscribe(fn);
const getSnapshot = () => getStore().getSnapshot();
const getServerSnapshot = () => SERVER;

/** Tonight's live scores, shared by every component on the page (one request per 30s while games are on). */
export function useLive(): LiveSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
