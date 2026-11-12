import { test } from "node:test";
import assert from "node:assert/strict";
import { actAs } from "./harness";
import { A, C } from "./fixtures";
import { feedWorld } from "./feed-fixtures";

const ACCEPT = ["🔥", "🐐", "👍🏽", "👨‍👩‍👧", "🇺🇸", "❤️", "#️⃣"];
const REJECT = ["", "lol", "a", "🔥🔥", "🔥a", " 🔥", "😂😂😂", "!"];

test("is_single_emoji accepts single emojis and rejects text or several emojis", async () => {
  const { db } = await feedWorld();
  for (const e of ACCEPT) assert.equal((await db.q(`select is_single_emoji($1) ok`, [e]))[0].ok, true, `accept ${e}`);
  for (const e of REJECT) assert.equal((await db.q(`select is_single_emoji($1) ok`, [e]))[0].ok, false, `reject ${JSON.stringify(e)}`);
});

test("toggle_reaction takes any emoji, caps at 50 distinct per user, and can still remove", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'hi') id`, [room]);
  assert.equal((await db.q(`select toggle_reaction($1, '🐐') on_`, [id]))[0].on_, true);
  await db.q(`select toggle_reaction($1, '🐐')`, [id]); // off again
  await db.q(
    `insert into room_event_reactions (event_id, user_id, emoji)
     select $1, $2, chr(x) from generate_series(x'1F600'::int, x'1F600'::int + 49) x`, [id, A]);
  await assert.rejects(db.q(`select toggle_reaction($1, '🐐')`, [id]), /That's enough reactions for one post\./);
  assert.equal((await db.q(`select toggle_reaction($1, '😀') on_`, [id]))[0].on_, false);
  await assert.rejects(db.q(`select toggle_reaction($1, 'lol')`, [id]), /Not a supported emoji\./);
});

test("a reply to a reply attaches to the top-level event", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id: top }] = await db.q(`select post_comment($1, 'top') id`, [room]);
  const [{ id: r1 }] = await db.q(`select post_reply($1, 'first') id`, [top]);
  const [{ id: r2 }] = await db.q(`select post_reply($1, '@a second') id`, [r1]);
  const rows = await db.q(`select id, kind, parent_id from room_events where id in ($1, $2) order by id`, [r1, r2]);
  assert.deepEqual(rows.map((r) => [r.kind, String(r.parent_id)]), [["reply", String(top)], ["reply", String(top)]]);
});

test("comments and replies share the 5-per-minute limit", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) ids.push((await db.q(`select post_comment($1, $2) id`, [room, `c${i}`]))[0].id);
  for (let i = 0; i < 2; i++) await db.q(`select post_reply($1, $2)`, [ids[0], `r${i}`]);
  await assert.rejects(db.q(`select post_reply($1, 'one more')`, [ids[0]]), /Slow down — try again in a minute\./);
  await assert.rejects(db.q(`select post_comment($1, 'one more')`, [room]), /Slow down — try again in a minute\./);
});

test("post_reply: length rules; non-members can't reply or read replies", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'top') id`, [room]);
  await assert.rejects(db.q(`select post_reply($1, '  ')`, [id]), /Replies are 1–280 characters\./);
  await assert.rejects(db.q(`select post_reply($1, $2)`, [id, "x".repeat(281)]), /Replies are 1–280 characters\./);
  await db.q(`select post_reply($1, 'ok')`, [id]);
  await actAs(db, C);
  await assert.rejects(db.q(`select post_reply($1, 'hi')`, [id]), /You are not in this room\./);
  assert.equal((await db.q(`select * from event_replies($1)`, [id])).length, 0);
});

test("room_feed: top level only, with reply_count and the latest 3 replies oldest first", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'top') id`, [room]);
  await db.q(`update room_events set created_at = now() - interval '2 minutes' where id = $1`, [id]);
  for (let i = 1; i <= 4; i++) await db.q(`select post_reply($1, $2)`, [id, `r${i}`]);
  await db.q(`update room_events set created_at = now() - interval '2 minutes' where parent_id = $1`, [id]);
  await db.q(`select post_reply($1, 'r5')`, [id]);
  const feed = await db.q(`select kind, reply_count, replies from room_feed($1)`, [room]);
  assert.ok(feed.every((f) => f.kind !== "reply"));
  const top = feed.find((f) => f.kind === "comment")!;
  assert.equal(top.reply_count, 5);
  assert.deepEqual((top.replies as { text: string }[]).map((r) => r.text), ["r3", "r4", "r5"]);
  const all = await db.q(`select text from event_replies($1)`, [id]);
  assert.deepEqual(all.map((r) => r.text), ["r1", "r2", "r3", "r4", "r5"]);
});

test("deleting a parent event or the room removes replies and their reactions", async () => {
  const { db, room } = await feedWorld();
  await actAs(db, A);
  const [{ id }] = await db.q(`select post_comment($1, 'top') id`, [room]);
  const [{ id: r }] = await db.q(`select post_reply($1, 'reply') id`, [id]);
  await db.q(`select toggle_reaction($1, '🐐')`, [r]);
  await db.q(`delete from room_events where id = $1`, [id]);
  assert.equal((await db.q(`select 1 from room_events where kind = 'reply'`)).length, 0);
  assert.equal((await db.q(`select 1 from room_event_reactions`)).length, 0);
  const [{ id: id2 }] = await db.q(`select post_comment($1, 'again') id`, [room]);
  const [{ id: r2 }] = await db.q(`select post_reply($1, 'reply') id`, [id2]);
  await db.q(`select toggle_reaction($1, '🧊')`, [r2]);
  await db.q(`select delete_room($1)`, [room]);
  assert.equal((await db.q(`select 1 from room_events`)).length, 0);
  assert.equal((await db.q(`select 1 from room_event_reactions`)).length, 0);
});
