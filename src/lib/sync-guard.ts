// Pure checks used by the nightly sync before it asks the database to price a night.

const SKIPPED = new Set(["STATUS_FINAL", "STATUS_POSTPONED", "STATUS_CANCELED"]);

/**
 * Games stored on a date that would block apply_real_game_night (not final, not
 * skipped) but that ESPN's scoreboard for that date no longer lists, e.g. a game
 * moved to another day while our schedule row still has the old date.
 */
export function staleGameIds(rows: { espn_id: string; status: string }[], scoreboardIds: string[]): string[] {
  const listed = new Set(scoreboardIds);
  return rows.filter((r) => !SKIPPED.has(r.status) && !listed.has(r.espn_id)).map((r) => r.espn_id);
}
