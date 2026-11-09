import { test } from "node:test";
import assert from "node:assert/strict";
import { isRoomEnded } from "./rooms";

test("room with an end date is open through that day (US Eastern) and ended after", () => {
  const room = { ends_at: "2026-12-25", finalized_at: null };
  assert.equal(isRoomEnded(room, "2026-12-25"), false);
  assert.equal(isRoomEnded(room, "2026-12-26"), true);
});

test("room without an end date never ends on its own", () => {
  assert.equal(isRoomEnded({ ends_at: null, finalized_at: null }, "2030-01-01"), false);
});

test("finalized room has ended", () => {
  assert.equal(isRoomEnded({ ends_at: null, finalized_at: "2026-12-26T10:00:00Z" }, "2026-12-01"), true);
});

import { pickCurrentRoom } from "./rooms";

const pub = { room: { id: "pub", is_public: true }, cash: 1 };
const priv = { room: { id: "friends", is_public: false }, cash: 2 };

test("current room: the cookie's room when you're a member", () => {
  assert.equal(pickCurrentRoom([pub, priv], "friends"), priv);
});

test("current room: falls back to Public for a stale, garbage, or missing cookie", () => {
  assert.equal(pickCurrentRoom([pub, priv], "removed-room-id"), pub);
  assert.equal(pickCurrentRoom([pub, priv], "not-a-uuid"), pub);
  assert.equal(pickCurrentRoom([pub, priv], undefined), pub);
});
