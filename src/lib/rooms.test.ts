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
