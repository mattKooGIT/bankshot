// Shared scenarios for the rooms tests.
import { actAs, addRealPlayers, applyMigration, freshDb, signUp, type Db } from "./harness";

export const A = "00000000-0000-0000-0000-00000000000a";
export const B = "00000000-0000-0000-0000-00000000000b";
export const C = "00000000-0000-0000-0000-00000000000c";
const ROSTER = [
  { espn_id: "1", name: "Shai Gilgeous-Alexander", team: "OKC", pos: "G" as const },
  { espn_id: "2", name: "Nikola Jokic", team: "DEN", pos: "C" as const },
];

/** Pre-rooms world (0001–0005) where A owns 3 SGA and B exists, then migrations from 0006 on. */
export async function migrated(): Promise<{ db: Db; cashBefore: number }> {
  const db = await freshDb({ through: "0005" });
  await addRealPlayers(db, ROSTER);
  await signUp(db, A, "a@example.com");
  await signUp(db, B, "b@example.com");
  await actAs(db, A);
  await db.q(`select execute_trade('SGA', 'buy', 3)`);
  const [{ cash }] = await db.q(`select cash from profiles where id = $1`, [A]);
  await actAs(db, null);
  await applyMigration(db, "0006");
  return { db, cashBefore: Number(cash) };
}

/** A private room owned by A (A is a member with `cash`). Inserted directly as test setup. */
export async function privateRoom(db: Db, opts: { cash?: number; ends_at?: string | null; code?: string } = {}) {
  const [{ id }] = await db.q(
    `insert into rooms (name, owner_id, invite_code, starting_cash, ends_at)
     values ('Friends', $1, $2, $3, $4) returning id`,
    [A, opts.code ?? "abc123abc123", opts.cash ?? 5000, opts.ends_at ?? null],
  );
  await db.q(`insert into room_members (room_id, user_id, cash) values ($1, $2, $3)`, [id, A, opts.cash ?? 5000]);
  return id as string;
}

export const cashIn = async (db: Db, room: string, user: string) =>
  Number((await db.q(`select cash from room_members where room_id = $1 and user_id = $2`, [room, user]))[0].cash);

/** Inserts one final game on `date` (OKC vs DEN) and applies it as a game night. */
export async function playNight(db: Db, date: string, out: string[] = []) {
  await db.q(`insert into games values ($1, $2, $3, 'STATUS_FINAL', 'OKC', 'DEN', 110, 100)`, [`n-${date}`, date, `${date}T23:00Z`]);
  await db.q(`select apply_real_game_night($1, $2)`, [date, out]);
}
