import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveStore } from "./live-store";
import type { LiveData, LiveGame } from "./live";

const game = (state: LiveGame["state"]): LiveGame =>
  ({ id: "g", state, status: "", period: 0, clock: "", startTime: "2026-11-10T00:00:00Z", home: { abbr: "A", score: 0 }, away: { abbr: "B", score: 0 } });
const data = (state: LiveGame["state"]): LiveData => ({ games: [game(state)], lines: [], updatedAt: "t", stale: false });

function harness(responses: (LiveData | Error)[]) {
  let fetches = 0;
  let visible = true;
  const timers: { fn: () => void; ms: number }[] = [];
  const store = createLiveStore({
    fetchLive: async () => {
      const r = responses[Math.min(fetches++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    },
    now: () => new Date("2026-11-10T00:30:00Z"),
    setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    clearTimer: (t) => { const i = timers.indexOf(t as never); if (i >= 0) timers.splice(i, 1); },
    isVisible: () => visible,
  });
  const flush = () => new Promise((r) => setImmediate(r));
  const fire = async () => { const t = timers.shift(); t?.fn(); await flush(); };
  return { store, flush, fire, timers, fetches: () => fetches, setVisible: (v: boolean) => { visible = v; } };
}

test("two subscribers share one fetch", async () => {
  const h = harness([data("in")]);
  h.store.subscribe(() => {});
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.fetches(), 1);
  assert.equal(h.store.getSnapshot().data?.games[0].state, "in");
});

test("re-polls every 30s while a game is live", async () => {
  const h = harness([data("in")]);
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.timers[0]?.ms, 30_000);
  await h.fire();
  assert.equal(h.fetches(), 2);
});

test("stops polling when every game is final", async () => {
  const h = harness([data("post")]);
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.timers.length, 0);
});

test("hidden tab doesn't fetch; becoming visible fetches immediately", async () => {
  const h = harness([data("in")]);
  h.store.subscribe(() => {});
  await h.flush();
  h.setVisible(false);
  await h.fire();
  assert.equal(h.fetches(), 1);
  h.setVisible(true);
  h.store.onVisibilityChange();
  await h.flush();
  assert.equal(h.fetches(), 2);
});

test("a failed fetch keeps the previous data and flags the error", async () => {
  const h = harness([data("in"), new Error("down")]);
  h.store.subscribe(() => {});
  await h.flush();
  await h.fire();
  const snap = h.store.getSnapshot();
  assert.equal(snap.error, true);
  assert.equal(snap.data?.games[0].state, "in");
});

test("last unsubscribe stops polling", async () => {
  const h = harness([data("in")]);
  const off = h.store.subscribe(() => {});
  await h.flush();
  off();
  assert.equal(h.timers.length, 0);
});

test("re-subscribing right after a fetch doesn't refetch (React re-subscribe on render)", async () => {
  const h = harness([data("in")]);
  const off = h.store.subscribe(() => {});
  await h.flush();
  off();
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.fetches(), 1);
  assert.equal(h.timers.length, 1);
});

test("before tip-off, wakes up 15 minutes before the first game", async () => {
  // harness now() is 00:30Z; game tips at 02:30Z, so wake at 02:15Z = 105 minutes from now
  const h = harness([{ ...data("pre"), games: [{ ...data("pre").games[0], startTime: "2026-11-10T02:30:00Z" }] }]);
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.timers[0]?.ms, 105 * 60_000);
});

test("a failed first fetch retries instead of giving up", async () => {
  const h = harness([new Error("blip"), data("in")]);
  h.store.subscribe(() => {});
  await h.flush();
  assert.equal(h.timers[0]?.ms, 30_000);
  await h.fire();
  assert.equal(h.store.getSnapshot().data?.games[0].state, "in");
});
