// Pure helpers for the nightly recap (shared by the banner, /recap, and the dev preview).
import { rankMove } from "./feed";

export type RecapRoom = {
  room_id: string; room_name: string; is_public: boolean;
  net_worth: number; change_pct: number; rank: number; prev_rank: number | null; size: number;
};
export type RecapPlayer = {
  ticker: string; name: string; total: number; status: string | null;
  line: { pts: number; reb: number; ast: number; stl: number; blk: number; tov: number; min?: number } | null;
};
export type Recap = { night: number; date: string | null; rooms: RecapRoom[]; best: RecapPlayer | null; worst: RecapPlayer | null };

/** "+4.2%" */
export function pct1(x: number): string {
  const v = Number(x) * 100;
  return `${v >= 0 ? "+" : "-"}${Math.abs(v).toFixed(1)}%`;
}

export function shouldShowBanner(recap: Recap | null, dismissedNight: number | null): boolean {
  return recap !== null && recap.rooms.length > 0 && recap.night !== dismissedNight;
}

/** "Last night: +4.2% · #2 in Friday Night Hoops (▲1) · Best: SGA +9.1%" */
export function bannerText(recap: Recap, currentRoomId: string): string {
  const r = recap.rooms.find((x) => x.room_id === currentRoomId) ?? recap.rooms[0];
  const move = rankMove(r.rank, r.prev_rank);
  let text = `Last night: ${pct1(r.change_pct)} · #${r.rank} in ${r.room_name}`;
  if (r.prev_rank !== null) text += ` (${move})`;
  if (recap.best) text += ` · Best: ${recap.best.ticker} ${pct1(recap.best.total)}`;
  return text;
}
