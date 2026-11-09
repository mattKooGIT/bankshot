// Made-up data for /dev/recap-preview only.
import type { FeedEvent } from "../feed";
import type { Recap } from "../recap";
import type { TopRow } from "@/components/RecapView";

export const recapFixture: Recap = {
  night: 3, date: "2026-11-11",
  rooms: [
    { room_id: "fnh", room_name: "Friday Night Hoops", is_public: false, net_worth: 10432.1, change_pct: 0.042, rank: 2, prev_rank: 3, size: 6 },
    { room_id: "pub", room_name: "Public", is_public: true, net_worth: 10188.4, change_pct: 0.0121, rank: 14, prev_rank: 20, size: 41 },
  ],
  best: { ticker: "SGA", name: "Shai Gilgeous-Alexander", total: 0.091, status: "played", line: { pts: 41, reb: 6, ast: 8, stl: 3, blk: 1, tov: 2, min: 36 } },
  worst: { ticker: "WEMBY", name: "Victor Wembanyama", total: -0.064, status: "played", line: { pts: 12, reb: 7, ast: 1, stl: 0, blk: 2, tov: 5, min: 29 } },
};

export const topsFixture: Record<string, TopRow[]> = {
  fnh: [
    { username: "jalen_b", net_worth: 10910.55, rank: 1 },
    { username: "you", net_worth: 10432.1, rank: 2 },
    { username: "marcus23", net_worth: 10120.0, rank: 3 },
  ],
};

export const nightEventFixture: FeedEvent = {
  id: "999", kind: "night", actor: null, created_at: new Date().toISOString(), reactions: { "🔥": 3, "💀": 1 }, mine: ["🔥"],
  payload: { night: 3, date: "2026-11-11", standings: [
    { username: "jalen_b", net_worth: 10910.55, change_pct: 0.061, rank: 1, prev_rank: 3, },
    { username: "you", net_worth: 10432.1, change_pct: 0.042, rank: 2, prev_rank: 2 },
    { username: "marcus23", net_worth: 10120.0, change_pct: -0.023, rank: 3, prev_rank: 1 },
    { username: "kev", net_worth: 9701.3, change_pct: -0.01, rank: 4, prev_rank: 4 },
  ] },
};
