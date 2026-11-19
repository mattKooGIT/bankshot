"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { eventText, rankMove, relativeTime, sortReactions, type FeedEvent, type NightStanding, type Reply } from "@/lib/feed";
import { formatMoney } from "@/lib/format";
import { pct1 } from "@/lib/recap";
import { EmojiMenu } from "./EmojiMenu";
import { loadFeed, loadReplies, postComment, postReply, toggleReaction } from "./feed-actions";

const POLL_MS = 30_000;
const PAGE = 30;
const box = "w-full resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40";
const postBtn = "rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-40";

function merge(a: FeedEvent[], b: FeedEvent[]) {
  const byId = new Map(a.map((e) => [e.id, e]));
  for (const e of b) byId.set(e.id, e);
  return [...byId.values()].sort((x, y) => Number(y.id) - Number(x.id));
}

type Reactable = { id: string; reactions: Record<string, number>; mine: string[] };

function flip<T extends Reactable>(x: T, emoji: string): T {
  const on = !x.mine.includes(emoji);
  return {
    ...x,
    mine: on ? [...x.mine, emoji] : x.mine.filter((m) => m !== emoji),
    reactions: { ...x.reactions, [emoji]: Math.max(0, (x.reactions[emoji] ?? 0) + (on ? 1 : -1)) },
  };
}

/** Where the open reply box is: under which thread, and the draft so far. Lives above the polled list. */
type Composer = { thread: string; draft: string; error: string | null };

export function Activity({ roomId, initial, me }: { roomId: string; initial: FeedEvent[]; me: string }) {
  const [events, setEvents] = useState(initial);
  const [hasOlder, setHasOlder] = useState(initial.length === PAGE);
  const [expanded, setExpanded] = useState<Record<string, Reply[]>>({});
  const [composer, setComposer] = useState<Composer | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async (thread?: string) => {
    const latest = await loadFeed(roomId);
    setEvents((cur) => merge(cur, latest));
    if (thread) {
      const all = await loadReplies(thread);
      setExpanded((cur) => (thread in cur ? { ...cur, [thread]: all } : cur));
    }
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

  /** Optimistically toggles a reaction on a top-level event or a reply (thread = its top-level event). */
  function react(target: Reactable, emoji: string, thread?: string) {
    if (thread) {
      const upd = (rs: Reply[]) => rs.map((r) => (r.id === target.id ? flip(r, emoji) : r));
      setEvents((cur) => cur.map((x) => (x.id === thread ? { ...x, replies: upd(x.replies) } : x)));
      setExpanded((cur) => (thread in cur ? { ...cur, [thread]: upd(cur[thread]) } : cur));
    } else {
      setEvents((cur) => cur.map((x) => (x.id === target.id ? flip(x, emoji) : x)));
    }
    startTransition(async () => {
      const r = await toggleReaction(target.id, emoji);
      if (!r.ok) setError(r.message ?? "Couldn't react.");
      await refresh(thread);
    });
  }

  function openReply(thread: string, to?: string | null) {
    setComposer((cur) => ({
      thread,
      draft: to ? `@${to} ` : cur?.thread === thread ? cur.draft : "",
      error: null,
    }));
  }

  function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!composer) return;
    const { thread, draft } = composer;
    startTransition(async () => {
      const r = await postReply(thread, draft);
      if (!r.ok) { setComposer((c) => (c ? { ...c, error: r.message ?? "Couldn't reply." } : c)); return; }
      setComposer(null);
      await refresh(thread);
    });
  }

  async function viewAll(thread: string) {
    const all = await loadReplies(thread);
    setExpanded((cur) => ({ ...cur, [thread]: all }));
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
          placeholder="Talk some trash…" aria-label="Comment" className={box} />
        <div className="flex items-center gap-3">
          <button disabled={pending || text.trim().length === 0} className={postBtn}>Post</button>
          <span className="text-xs text-white/40">{text.length}/280</span>
          {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
        </div>
      </form>

      {events.length === 0 ? (
        <p className="rounded-lg border border-white/10 p-4 text-sm text-white/50">No activity yet. Make a trade or say something.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
          {events.map((ev) => {
            const replies = expanded[ev.id] ?? ev.replies;
            const hidden = ev.reply_count - replies.length;
            return (
              <li key={ev.id} className="px-4 py-3">
                {ev.kind === "night" ? <NightCard ev={ev} me={me} /> : (
                  <p>
                    <span className="font-semibold">{ev.actor ?? "someone"}</span>{" "}
                    <span className={ev.kind === "comment" ? "text-white" : "text-white/70"}>{eventText(ev)}</span>
                  </p>
                )}
                <Reactions item={ev} time={relativeTime(ev.created_at, now)}
                  onToggle={(e) => react(ev, e)} onReply={() => openReply(ev.id)} />

                {(replies.length > 0 || composer?.thread === ev.id) && (
                  <div className="mt-2 space-y-2 border-l border-white/10 pl-3">
                    {hidden > 0 && (
                      <button type="button" onClick={() => viewAll(ev.id)} className="text-xs text-white/60 underline hover:text-white">
                        View all {ev.reply_count} replies
                      </button>
                    )}
                    {replies.map((r) => (
                      <div key={r.id}>
                        <p><span className="font-semibold">{r.actor ?? "someone"}</span> <span>{r.text}</span></p>
                        <Reactions item={r} time={relativeTime(r.created_at, now)}
                          onToggle={(e) => react(r, e, ev.id)} onReply={() => openReply(ev.id, r.actor)} />
                      </div>
                    ))}
                    {composer?.thread === ev.id && (
                      <form onSubmit={sendReply} className="space-y-2">
                        <textarea autoFocus value={composer.draft} maxLength={280} rows={2} aria-label="Reply" placeholder="Reply…"
                          onChange={(e) => setComposer({ ...composer, draft: e.target.value })} className={box} />
                        <div className="flex items-center gap-3">
                          <button disabled={pending || composer.draft.trim().length === 0} className={postBtn}>Reply</button>
                          <button type="button" onClick={() => setComposer(null)} className="text-xs text-white/60 hover:text-white">Cancel</button>
                          {composer.error && <span role="alert" className="text-xs text-red-300">{composer.error}</span>}
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {hasOlder && (
        <button type="button" onClick={older} className="mt-3 text-sm text-white/60 underline hover:text-white">Show older</button>
      )}
    </section>
  );
}

function Reactions({ item, time, onToggle, onReply }: {
  item: Reactable; time: string; onToggle: (emoji: string) => void; onReply: () => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {sortReactions(item.reactions).map(([emoji, count]) => {
        const mine = item.mine.includes(emoji);
        return (
          <button key={emoji} type="button" onClick={() => onToggle(emoji)} aria-pressed={mine} aria-label={`${emoji} ${count}`}
            className={`rounded-full border px-2 py-0.5 text-xs ${mine ? "border-emerald-400/60 bg-emerald-500/15" : "border-white/10 hover:border-white/30"}`}>
            {emoji}<span className="ml-1 tabular-nums text-white/70">{count}</span>
          </button>
        );
      })}
      <EmojiMenu mine={item.mine} onPick={onToggle} />
      <button type="button" onClick={onReply} className="ml-1 text-xs text-white/50 hover:text-white">Reply</button>
      <span className="ml-auto text-xs text-white/40">{time}</span>
    </div>
  );
}

export function NightCard({ ev, me }: { ev: FeedEvent; me: string }) {
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
              <td className={`text-right ${s.change_pct > 0 ? "text-emerald-400" : s.change_pct < 0 ? "text-red-400" : ""}`}>{pct1(Number(s.change_pct))}</td>
              <td className="w-24 text-right">{formatMoney(s.net_worth)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
