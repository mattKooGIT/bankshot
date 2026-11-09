// One shared poller for /api/live, so the header badge, /scores and the player line
// cause a single request every 30s. Pure (deps injected) so it's testable without a browser.
import { shouldPoll, type LiveData } from "./live";

export const POLL_MS = 30_000;

export type LiveSnapshot = { data: LiveData | null; error: boolean };

export function createLiveStore(deps: {
  fetchLive: () => Promise<LiveData>;
  now: () => Date;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (t: unknown) => void;
  isVisible: () => boolean;
}) {
  let snapshot: LiveSnapshot = { data: null, error: false };
  const listeners = new Set<() => void>();
  let timer: unknown = null;
  let inFlight = false;

  const emit = () => listeners.forEach((l) => l());

  function stop() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function schedule() {
    stop();
    if (listeners.size === 0 || !snapshot.data || !shouldPoll(snapshot.data.games, deps.now())) return;
    timer = deps.setTimer(() => {
      timer = null;
      // Hidden tab: skip; onVisibilityChange() resumes with an immediate fetch.
      if (deps.isVisible()) void refresh();
    }, POLL_MS);
  }

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    try {
      snapshot = { data: await deps.fetchLive(), error: false };
    } catch {
      snapshot = { data: snapshot.data, error: true }; // keep showing the last good data
    } finally {
      inFlight = false;
    }
    emit();
    schedule();
  }

  return {
    subscribe(fn: () => void) {
      listeners.add(fn);
      if (listeners.size === 1) void refresh();
      return () => {
        listeners.delete(fn);
        if (listeners.size === 0) stop();
      };
    },
    getSnapshot: () => snapshot,
    onVisibilityChange() {
      if (deps.isVisible() && listeners.size > 0) void refresh();
    },
  };
}
