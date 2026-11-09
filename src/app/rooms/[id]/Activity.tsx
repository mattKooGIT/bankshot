"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { eventText, rankMove, REACTIONS, relativeTime, type FeedEvent, type NightStanding } from "@/lib/feed";
import { formatMoney, formatPct } from "@/lib/format";
import { loadFeed, postComment, toggleReaction } from "./feed-actions";

const POLL_MS = 30_000;
const PAGE = 30;

function merge(a: FeedEvent[], b: FeedEvent[]) {
  const byId = new Map(a.map((e) => [e.id, e]));
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => Number(y.id) - Number(x.id));
}

export function Activity({ roomId, initial, me }: { roomId: string; initial: FeedEvent[]; me: string }) {
  const [events, setEvents] = useState(initial);
  const [hasOlder, setHasOlder] = useState(initial.length === PAGE);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    const latest = await loadFeed(roomId);
    setEvents((cur) => merge(cur, latest));
    setNow(new Date());
  }, [roomId]);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const r = await postComment(roomId, text);
      if (!r.ok) { setError(r.message ?? "Couldn't post."); return; }
      setText(""); setError(null);
      await refresh();
    });
  }

  function react(ev: FeedEvent, emoji: string) {
    // Optimistic: flip it locally, then reconcile with the server.
    const on = !ev.mine.includes(emoji);
    setEvents((cur) => cur.map((x) => x.id !== ev.id ? x : {
      ...x,
      mine: on ? [...x.mine, emoji] : x.mine.filter((m) => m !== emoji),
      reactions: { ...x.reactions, [emoji]: Math.max(0, (x.reactions[emoji] ?? 0) + (on ? 1 : -1)) },
    }));
    startTransition(async () => {
      const r = await toggleReaction(ev.id, emoji);
      if (!r.ok) setError(r.message ?? "Couldn't react.");
      await refresh();
    });
  }

  async function older() {
    const page = await loadFeed(roomId, events[events.length - 1]?.id);
    setEvents((cur) => merge(cur, page));
    setHasOlder(page.length === PAGE);
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-white/60">Activity</h2>
      <p className="mb-3 text-xs text-white/40">Room members can see each other&apos;s trades.</p>

      <form onSubmit={submit} className="mb-4 space-y-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={280} rows={2}
          placeholder="Talk some trash…" aria-label="Comment"
          className="w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40" />
        <div className="flex items-center gap-3">
          <button disabled={pending || text.trim().length === 0}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-40">
            Post
          </button>
          <span className="text-xs text-white/40">{text.length}/280</span>
          {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
        </div>
      </form>

      {events.length === 0 ? (
        <p className="rounded-lg border border-white/10 p-4 text-sm text-white/50">No activity yet. Make a trade or say something.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="px-4 py-3">
              {ev.kind === "night" ? <NightCard ev={ev} me={me} /> : (
                <p>
                  <span className="font-semibold">{ev.actor ?? "someone"}</span>{" "}
                  <span className={ev.kind === "comment" ? "text-white" : "text-white/70"}>{eventText(ev)}</span>
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {REACTIONS.map((emoji) => {
                  const count = ev.reactions[emoji] ?? 0;
                  const mine = ev.mine.includes(emoji);
                  return (
                    <button key={emoji} type="button" onClick={() => react(ev, emoji)} aria-pressed={mine}
                      aria-label={`${emoji} ${count}`}
                      className={`rounded-full border px-2 py-0.5 text-xs ${mine ? "border-emerald-400/60 bg-emerald-500/15" : "border-white/10 hover:border-white/30"} ${count === 0 && !mine ? "opacity-50 hover:opacity-100" : ""}`}>
                      {emoji}{count > 0 && <span className="ml-1 tabular-nums text-white/70">{count}</span>}
                    </button>
                  );
                })}
                <span className="ml-auto text-xs text-white/40">{relativeTime(ev.created_at, now)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hasOlder && (
        <button type="button" onClick={older} className="mt-3 text-sm text-white/60 underline hover:text-white">Show older</button>
      )}
    </section>
  );
}

function NightCard({ ev, me }: { ev: FeedEvent; me: string }) {
  const standings = (ev.payload.standings as NightStanding[] | undefined) ?? [];
  const top = standings.slice(0, 3);
  const mine = standings.find((s) => s.username === me);
  const rows = mine && !top.includes(mine) ? [...top, mine] : top;
  return (
    <div>
      <p className="font-semibold text-[#d9a05b]">{eventText(ev)}</p>
      <table className="mt-2 w-full text-xs tabular-nums">
        <tbody>
          {rows.map((s) => (
            <tr key={s.username} className={s.username === me ? "text-white" : "text-white/70"}>
              <td className="w-8 py-0.5">#{s.rank}</td>
              <td className="w-10 text-white/50">{rankMove(s.rank, s.prev_rank)}</td>
              <td>{s.username}{s.username === me && <span className="ml-1 text-emerald-300">(you)</span>}</td>
              <td className={`text-right ${s.change_pct > 0 ? "text-emerald-400" : s.change_pct < 0 ? "text-red-400" : ""}`}>{formatPct(Number(s.change_pct))}</td>
              <td className="w-24 text-right">{formatMoney(s.net_worth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
