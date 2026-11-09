// Supabase's pg-safeupdate rejects UPDATE/DELETE without WHERE on API requests.
// Every migration from 0006 on must say WHERE explicitly (use `where true` for all rows).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { migrationFiles } from "./harness";

const UPDATE = /\b(?<!do\s)update\s+[\w.]+(\s+\w+)?\s+set\b[^;]*;/gi;
const DELETE = /\bdelete\s+from\s+[\w.]+[^;]*;/gi;

export function unsafeStatements(sql: string): string[] {
  const noComments = sql.replace(/--.*$/gm, "");
  return [...noComments.matchAll(UPDATE), ...noComments.matchAll(DELETE)]
    .map((m) => m[0])
    .filter((s) => !/\bwhere\b/i.test(s));
}

test("detector flags an UPDATE without WHERE", () => {
  assert.equal(unsafeStatements("update players set price = 1;").length, 1);
  assert.equal(unsafeStatements("update players set price = 1 where true;").length, 0);
  assert.equal(unsafeStatements("insert into h values (1) on conflict (a) do update set b = 1;").length, 0);
  assert.equal(unsafeStatements("select * from players where x for update;").length, 0);
});

test("migrations 0006+ have WHERE on every UPDATE/DELETE", () => {
  for (const file of migrationFiles().filter((f) => f >= "0006")) {
    const sql = readFileSync(join(import.meta.dirname, "..", "migrations", file), "utf8");
    assert.deepEqual(unsafeStatements(sql), [], `${file} has UPDATE/DELETE without WHERE`);
  }
});
