// Pure helpers for the room activity feed (no server imports, so client components can use them).
import { formatMoney } from "./format";

/** The "Popular" row at the top of the emoji menu. */
export const POPULAR = ["🔥", "😂", "💀", "📉"] as const;

export type Reply = {
  id: string;
  actor: string | null;
  text: string;
  created_at: string;
  reactions: Record<string, number>;
  mine: string[];
};

export type FeedEvent = {
  id: string;
  kind: "trade" | "join" | "leave" | "night" | "comment";
  actor: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  reactions: Record<string, number>;
  mine: string[];
  reply_count: number;
  replies: Reply[];
};

export type NightStanding = { username: string; net_worth: number; change_pct: number; rank: number; prev_rank: number | null };

export function relativeTime(iso: string, now = new Date()): string {
  const s = (now.getTime() - new Date(iso).getTime()) / 1000;
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const monthDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The words after the username (or the whole title, for a night post). */
export function eventText(e: FeedEvent): string {
  const p = e.payload;
  switch (e.kind) {
    case "trade":
      return `${p.side === "buy" ? "bought" : "sold"} ${p.shares} ${p.ticker} at ${formatMoney(p.price as number)}`;
    case "join": return "joined";
    case "leave": return "left";
    case "comment": return String(p.text ?? "");
    case "night":
      return `Night ${p.night}${p.date ? ` · ${monthDay.format(new Date(`${p.date}T12:00:00Z`))}` : ""}`;
  }
}

/** "▲2" moved up, "▼1" moved down, "–" no change or no previous night. */
export function rankMove(rank: number, prev: number | null): string {
  if (prev === null || prev === rank) return "–";
  return prev > rank ? `▲${prev - rank}` : `▼${rank - prev}`;
}

/** Reaction chips to show: used emojis only, most used first, ties by code point. */
export function sortReactions(r: Record<string, number>): [string, number][] {
  return Object.entries(r)
    .filter(([, n]) => n > 0)
    .sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0));
}

/** Database ids are bigints; the UI keys everything by string id. */
export function normalizeFeed(rows: FeedEvent[]): FeedEvent[] {
  return rows.map((e) => ({ ...e, id: String(e.id), replies: (e.replies ?? []).map((r) => ({ ...r, id: String(r.id) })) }));
}
