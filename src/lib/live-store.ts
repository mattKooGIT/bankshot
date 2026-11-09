// One shared poller for /api/live, so the header badge, /scores and the player line
// cause a single request every 30s. Pure (deps injected) so it's testable without a browser.
import { shouldPoll, TIP_WINDOW_MS, type LiveData } from "./live";

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
  let lastFetchAt = 0;

  const emit = () => listeners.forEach((l) => l());

  function stop() {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
  }

  function nextDelay(): number | null {
    const data = snapshot.data;
    if (!data) return snapshot.error ? POLL_MS : null; // first fetch failed: retry
    const now = deps.now();
    if (shouldPoll(data.games, now)) return POLL_MS;
    // Nothing live yet: wake up 15 minutes before the first tip-off.
    const tips = data.games.filter((g) => g.state === "pre").map((g) => new Date(g.startTime).getTime());
    if (tips.length === 0) return null; // all final or no games: done for the night
    return Math.max(POLL_MS, Math.min(...tips) - TIP_WINDOW_MS - now.getTime());
  }

  function schedule() {
    stop();
    if (listeners.size === 0) return;
    const delay = nextDelay();
    if (delay === null) return;
    timer = deps.setTimer(() => {
      timer = null;
      // Hidden tab: skip; onVisibilityChange() resumes with an immediate fetch.
      if (deps.isVisible()) void refresh();
    }, delay);
  }

  async function refresh() {
    if (inFlight) return;
    inFlight = true;
    lastFetchAt = deps.now().getTime();
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
      if (listeners.size === 1) {
        // React may unsubscribe/resubscribe on re-render; don't treat that as a new viewer.
        const fresh = snapshot.data && deps.now().getTime() - lastFetchAt < POLL_MS;
        if (fresh) schedule();
        else void refresh();
      }
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
