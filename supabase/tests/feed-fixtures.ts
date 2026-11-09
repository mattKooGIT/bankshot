import { actAs, setToday, type Db } from "./harness";
import { A, B, C, migrated } from "./fixtures";

/** A creates "Friends" and B joins; C exists but isn't a member. */
export async function feedWorld() {
  const { db } = await migrated();
  await db.q(`insert into auth.users (id, email) values ($1, 'c@example.com')`, [C]);
  await setToday(db, "2026-11-09");
  await actAs(db, A);
  const [{ r }] = await db.q(`select create_room('Friends', 5000, null, null) r`);
  await actAs(db, B);
  await db.q(`select join_room($1)`, [r.invite_code]);
  return { db, room: r.id as string };
}

export const events = (db: Db, room: string) =>
  db.q<{ id: string; kind: string; actor_id: string | null; payload: Record<string, unknown> }>(
    `select id, kind, actor_id, payload from room_events where room_id = $1 order by id`, [room]);
