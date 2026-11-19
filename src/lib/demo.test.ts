import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_BOTS, isGuest } from "./demo";

test("isGuest: only anonymous sign-ins are guests", () => {
  assert.equal(isGuest({ is_anonymous: true }), true);
  assert.equal(isGuest({ is_anonymous: false }), false);
  assert.equal(isGuest({}), false);
  assert.equal(isGuest(null), false);
  assert.equal(isGuest(undefined), false);
});

test("the demo bots match the database seed", () => {
  assert.deepEqual([...DEMO_BOTS], ["bucket_getter", "fade_master", "sixth_man"]);
});
