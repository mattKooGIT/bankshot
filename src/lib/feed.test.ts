import { test } from "node:test";
import assert from "node:assert/strict";
import { eventText, rankMove, relativeTime, type FeedEvent } from "./feed";

const now = new Date("2026-11-10T12:00:00Z");
test("relativeTime", () => {
  assert.equal(relativeTime("2026-11-10T11:59:40Z", now), "just now");
  assert.equal(relativeTime("2026-11-10T11:55:00Z", now), "5m ago");
  assert.equal(relativeTime("2026-11-10T09:00:00Z", now), "3h ago");
  assert.equal(relativeTime("2026-11-08T12:00:00Z", now), "2d ago");
});

const ev = (kind: FeedEvent["kind"], payload: Record<string, unknown>): FeedEvent =>
  ({ id: "1", kind, actor: "matt", payload, created_at: "", reactions: {}, mine: [] });
test("eventText for each kind", () => {
  assert.equal(eventText(ev("trade", { side: "buy", ticker: "SGA", shares: 40, price: 55.24 })), "bought 40 SGA at $55.24");
  assert.equal(eventText(ev("trade", { side: "sell", ticker: "SGA", shares: 1, price: 60 })), "sold 1 SGA at $60.00");
  assert.equal(eventText(ev("join", {})), "joined");
  assert.equal(eventText(ev("leave", {})), "left");
  assert.equal(eventText(ev("comment", { text: "gg" })), "gg");
  assert.equal(eventText(ev("night", { night: 3, date: "2026-11-10" })), "Night 3 · Nov 10");
});

test("rankMove", () => {
  assert.equal(rankMove(1, 3), "▲2");
  assert.equal(rankMove(3, 2), "▼1");
  assert.equal(rankMove(2, 2), "–");
  assert.equal(rankMove(2, null), "–");
});
