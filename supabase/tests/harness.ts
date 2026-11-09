// PGlite (Postgres in WASM) with just enough of Supabase stubbed to run our migrations.
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const MIGRATIONS = join(ROOT, "migrations");

export type Db = {
  q<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
};

const SUPABASE_STUBS = `
create role anon; create role authenticated;
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** A new database with migrations applied in order, up to and including `through` (a file name prefix like "0005"). */
export async function freshDb(opts: { through?: string } = {}): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    q: async (sql, params) => (await pg.query(sql, params as any[])).rows as any[],
    exec: async (sql) => { await pg.exec(sql); },
  };
  await db.exec(SUPABASE_STUBS);
  for (const file of migrationFiles()) {
    if (opts.through && file.slice(0, 4) > opts.through) break;
    await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
    if (file.startsWith("0001")) await db.exec(readFileSync(join(ROOT, "seed.sql"), "utf8"));
  }
  return db;
}

/** Applies one more migration file (e.g. "0006") to an existing database. */
export async function applyMigration(db: Db, prefix: string) {
  const file = migrationFiles().find((f) => f.startsWith(prefix));
  if (!file) throw new Error(`No migration ${prefix}`);
  await db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
}

/** Creates an auth user, which fires handle_new_user(). */
export async function signUp(db: Db, id: string, email: string) {
  await db.q(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
}

/** Subsequent queries run as this user (auth.uid()), or signed out with null. */
export async function actAs(db: Db, id: string | null) {
  await db.q(`select set_config('request.jwt.claim.sub', $1, false)`, [id ?? ""]);
}

/** Adds real-looking box scores for these players on `games` final dates from 2026-10-21, then bootstraps the market. */
export async function addRealPlayers(
  db: Db,
  rows: { espn_id: string; name: string; team: string; pos: "G" | "F" | "C" }[],
  games = 3,
) {
  for (let i = 0; i < games; i++) {
    const date = `2026-10-${String(21 + i).padStart(2, "0")}`;
    const gid = `seed-g${i}`;
    await db.q(`insert into games values ($1, $2, $3, 'STATUS_FINAL', 'AAA', 'BBB', 100, 99) on conflict do nothing`,
      [gid, date, `${date}T23:00Z`]);
    for (const r of rows) {
      await db.q(
        `insert into player_game_stats (game_id, espn_id, name, team, position, game_date, min, pts, reb, ast, stl, blk, tov)
         values ($1, $2, $3, $4, $5, $6, 25, 15, 5, 3, 1, 1, 2)`,
        [gid, r.espn_id, r.name, r.team, r.pos, date],
      );
    }
  }
  await db.q(`select bootstrap_market()`);
}

/** Pins eastern_today() (created in 0006) to a fixed date. */
export async function setToday(db: Db, date: string) {
  await db.exec(`create or replace function public.eastern_today() returns date language sql stable as $$ select '${date}'::date $$;`);
}
