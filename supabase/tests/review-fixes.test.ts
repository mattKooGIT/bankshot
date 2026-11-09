import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, setToday } from "./harness";
import { A, B, migrated, playNight, privateRoom } from "./fixtures";

test("usernames are unique ignoring case at the database level", async () => {
  const { db } = await migrated();
  await db.q(`update profiles set username = 'bob' where id = $1`, [A]);
  await assert.rejects(db.q(`update profiles set username = 'BOB' where id = $1`, [B]), /duplicate key|unique/);
});

test("owner can't remove members once the room is final", async () => {
  const { db } = await migrated();
  const room = await privateRoom(db, { ends_at: "2026-10-23" });
  await db.q(`insert into room_members (room_id, user_id, cash) values ($1, $2, 5000)`, [room, B]);
  await playNight(db, "2026-10-24");
  await setToday(db, "2026-10-25");
  await actAs(db, A);
  await assert.rejects(db.q(`select remove_member($1, $2)`, [room, B]), /This room has ended\./);
});
