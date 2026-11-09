import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "@/lib/supabase/server";

test("safeNext keeps same-site paths", () => {
  assert.equal(safeNext("/join/abc123abc123"), "/join/abc123abc123");
  assert.equal(safeNext("/players/SGA?x=1"), "/players/SGA?x=1");
});

test("safeNext rejects protocol-relative and control-character tricks", () => {
  for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "/\r//evil.com", "/a\\b", "https://evil.com"]) {
    assert.equal(safeNext(bad), "/", JSON.stringify(bad));
  }
});
