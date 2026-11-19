import { analystNote, type Note, type NoteTag } from "@/lib/analyst-note";
import { getTeamGames } from "@/lib/analyst";
import { getMarket, getPriceHistory, type Player } from "@/lib/market";

const TAG_STYLE: Record<NoteTag, string> = {
  "Bigger role": "bg-emerald-500/15 text-emerald-300",
  "Heating up": "bg-emerald-500/15 text-emerald-300",
  "Role may shrink": "bg-amber-500/15 text-amber-300",
  "Cooling off": "bg-amber-500/15 text-amber-300",
  Sidelined: "bg-red-500/15 text-red-300",
};

/** "Why is his production changing?" — a short note from box scores; renders nothing when no signal fires. */
export async function AnalystNote({ player }: { player: Player }) {
  if (!player.espn_id || !player.team) return null;
  let note: Note | null;
  try {
    const [market, games, history] = await Promise.all([
      getMarket(), getTeamGames(player.team), getPriceHistory(player.ticker),
    ]);
    const teammates = market
      .filter((p) => p.team === player.team && p.espn_id && p.espn_id !== player.espn_id)
      .map((p) => ({ espn_id: p.espn_id!, name: p.name, avg_min: p.avg_min, out_nights: p.out_nights, injury_note: p.injury_note }));
    note = analystNote({
      player: {
        espn_id: player.espn_id, name: player.name, team: player.team, avg_min: player.avg_min,
        out_nights: player.out_nights, injury_note: player.injury_note,
      },
      teammates,
      games,
      prices: history.slice(-6).map((h) => h.price),
    });
  } catch (err) {
    console.warn(`Analyst note skipped for ${player.ticker}:`, err);
    return null;
  }
  if (!note) return null;

  return (
    <section aria-label="Analyst note" className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-sm">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-medium">Analyst note</h2>
        <span className={`rounded px-1.5 text-[10px] font-semibold uppercase ${TAG_STYLE[note.tag]}`}>{note.tag}</span>
      </div>
      <div className="space-y-2 text-white/80">
        {note.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <p className="mt-3 text-xs text-white/40">Based on box scores. Not a recommendation.</p>
    </section>
  );
}
