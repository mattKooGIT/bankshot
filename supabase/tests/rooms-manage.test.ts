import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs, asRole, setToday, type Db } from "./harness";
import { A, B, C, migrated } from "./fixtures";

const create = (db: Db, name: string, cash: number, cap: number | null, ends: string | null) =>
  db.q(`select create_room($1, $2, $3, $4) r`, [name, cash, cap, ends]).then((r) => r[0].r as { id: string; invite_code: string });

async function world() {
  const { db } = await migrated();
  await db.q(`insert into auth.users (id, email) values ($1, 'c@example.com')`, [C]);
  await setToday(db, "2026-11-09");
  await actAs(db, A);
  return db;
}

test("create_room validates limits", async () => {
  const db = await world();
  await assert.rejects(create(db, "", 5000, null, null), /Room name must be 1–40 characters\./);
  await assert.rejects(create(db, "x".repeat(41), 5000, null, null), /Room name must be 1–40 characters\./);
  await assert.rejects(create(db, "R", 999, null, null), /Starting cash must be between \$1,000 and \$1,000,000\./);
  await assert.rejects(create(db, "R", 1000001, null, null), /Starting cash must be between/);
  await assert.rejects(create(db, "R", 5000, 1, null), /Member cap must be between 2 and 50\./);
  await assert.rejects(create(db, "R", 5000, 51, null), /Member cap must be between 2 and 50\./);
  await assert.rejects(create(db, "R", 5000, null, "2026-11-09"), /End date must be in the future\./);
  assert.ok((await create(db, "Low", 1000, null, null)).id);
  assert.ok((await create(db, "High", 1000000, 50, "2026-11-10")).invite_code.length >= 10);
});

test("create then join", async () => {
  const db = await world();
  const room = await create(db, "Friends", 5000, null, null);
  await actAs(db, B);
  assert.equal((await db.q(`select join_room($1) id`, [room.invite_code]))[0].id, room.id);
  const [m] = await db.q(`select cash from room_members where room_id = $1 and user_id = $2`, [room.id, B]);
  assert.equal(Number(m.cash), 5000);
  const roster = await db.q(`select user_id, is_owner from room_roster($1)`, [room.id]);
  assert.equal(roster.length, 2);
  assert.deepEqual(roster.filter((r) => r.is_owner).map((r) => r.user_id), [A]);
});

test("member cap enforced", async () => {
  const db = await world();
  const room = await create(db, "Tiny", 5000, 2, null);
  await actAs(db, B);
  await db.q(`select join_room($1)`, [room.invite_code]);
  await actAs(db, C);
  await assert.rejects(db.q(`select join_room($1)`, [room.invite_code]), /This room is full\./);
});

test("rejoin rejected", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, null);
  await assert.rejects(db.q(`select join_room($1)`, [room.invite_code]), /You're already in this room\./);
});

test("ended room rejects join", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, "2026-11-20");
  await setToday(db, "2026-11-21");
  await actAs(db, B);
  await assert.rejects(db.q(`select join_room($1)`, [room.invite_code]), /This room has ended\./);
});

test("reset invite kills old link", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, null);
  const [{ code }] = await db.q(`select reset_invite($1) code`, [room.id]);
  assert.notEqual(code, room.invite_code);
  const [{ p }] = await db.q(`select room_preview($1) p`, [room.invite_code]);
  assert.equal(p, null);
  await actAs(db, B);
  await assert.rejects(db.q(`select join_room($1)`, [room.invite_code]), /This invite link is no longer valid\./);
  await db.q(`select join_room($1)`, [code]);
});

test("owner-only actions", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, null);
  await actAs(db, B);
  await db.q(`select join_room($1)`, [room.invite_code]);
  await assert.rejects(db.q(`select remove_member($1, $2)`, [room.id, A]), /Only the room owner can do that\./);
  await assert.rejects(db.q(`select reset_invite($1)`, [room.id]), /Only the room owner can do that\./);
  await assert.rejects(db.q(`select room_invite($1)`, [room.id]), /Only the room owner can do that\./);
  await actAs(db, A);
  await assert.rejects(db.q(`select remove_member($1, $2)`, [room.id, A]), /You can't remove yourself\./);
  await assert.rejects(db.q(`select reset_invite(public_room_id())`), /The Public room can't be changed\./);
});

test("remove cascades only that room", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, null);
  await actAs(db, B);
  await db.q(`select join_room($1)`, [room.invite_code]);
  await db.q(`select execute_trade($1, 'SGA', 'buy', 2)`, [room.id]);
  await db.q(`select execute_trade(public_room_id(), 'SGA', 'buy', 1)`);
  await actAs(db, A);
  await db.q(`select remove_member($1, $2)`, [room.id, B]);
  const left = await db.q(`select room_id from holdings where user_id = $1`, [B]);
  assert.deepEqual(left.map((r) => r.room_id), ["00000000-0000-4000-8000-000000000001"]);
  assert.equal((await db.q(`select 1 from trades where user_id = $1 and room_id = $2`, [B, room.id])).length, 0);
  assert.equal((await db.q(`select 1 from room_members where user_id = $1 and room_id = $2`, [B, room.id])).length, 0);
  assert.equal((await db.q(`select 1 from trades where user_id = $1`, [B])).length, 1);
});

test("members cannot read invite_code or others' cash", async () => {
  const db = await world();
  const room = await create(db, "R", 5000, null, null);
  await actAs(db, B);
  await db.q(`select join_room($1)`, [room.invite_code]);
  await asRole(db, "authenticated");
  await assert.rejects(db.q(`select invite_code from rooms`), /permission denied/);
  const visible = await db.q(`select user_id from room_members`);
  assert.ok(visible.length > 0 && visible.every((r) => r.user_id === B));
  assert.equal((await db.q(`select id from rooms where id = $1`, [room.id])).length, 1);
  await asRole(db, null);
});

test("room_preview works signed out", async () => {
  const db = await world();
  const room = await create(db, "Friday Hoops", 5000, 8, "2026-12-25");
  await actAs(db, null);
  await asRole(db, "anon");
  const [{ p }] = await db.q(`select room_preview($1) p`, [room.invite_code]);
  await asRole(db, null);
  assert.equal(p.name, "Friday Hoops");
  assert.equal(p.member_count, 1);
  assert.equal(p.member_cap, 8);
  assert.equal(Number(p.starting_cash), 5000);
  assert.equal(p.ended, false);
  assert.ok(p.owner_username);
});

test("set_username: case-only rename, taken names, format", async () => {
  const db = await world();
  assert.equal((await db.q(`select set_username('matt') u`))[0].u, "matt");
  assert.equal((await db.q(`select set_username('Matt') u`))[0].u, "Matt");
  await actAs(db, B);
  await db.q(`select set_username('joe')`);
  await actAs(db, A);
  await assert.rejects(db.q(`select set_username('JOE')`), /That username is taken\./);
  await assert.rejects(db.q(`select set_username('ab')`), /Usernames are 3–20 letters, numbers, or underscores\./);
  await assert.rejects(db.q(`select set_username('bad-name!')`), /Usernames are 3–20 letters, numbers, or underscores\./);
});
