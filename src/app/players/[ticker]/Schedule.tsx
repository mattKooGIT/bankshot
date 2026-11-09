import { dateLabel, dayLabel, getPlayerSchedule, matchup, tipTime } from "@/lib/schedule";

export async function Schedule({ team, espnId, expectedFp }: { team: string | null; espnId: string | null; expectedFp: number }) {
  const { today, upcoming, log } = await getPlayerSchedule(team, espnId);

  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Upcoming</h2>
        {upcoming.length === 0 || !team ? (
          <p className="text-sm text-white/40">No upcoming games scheduled.</p>
        ) : (
          <ul className="max-w-md divide-y divide-white/5 rounded-lg border border-white/10 text-sm">
            {upcoming.map((g) => {
              const off = g.status === "STATUS_POSTPONED" || g.status === "STATUS_CANCELED";
              return (
                <li key={g.id} className="flex items-center gap-3 px-3 py-2">
                  <span className={`w-28 ${g.date === today ? "font-medium text-emerald-300" : ""}`}>{dayLabel(g.date, today)}</span>
                  <span className="flex-1">{matchup(g, team)}</span>
                  <span className="text-xs text-white/50">{off ? (g.status === "STATUS_CANCELED" ? "Canceled" : "Postponed") : tipTime(g.startTime)}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-white/60">Recent games</h2>
        {log.length === 0 ? (
          <p className="text-sm text-white/40">No games played yet this season.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full whitespace-nowrap text-xs">
              <thead className="bg-white/[0.03] text-white/50">
                <tr>
                  <th className="px-2 py-1.5 text-left font-medium">Date</th>
                  <th className="px-2 py-1.5 text-left font-medium">Opp</th>
                  <th className="px-2 py-1.5 text-left font-medium">Result</th>
                  {["MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FP"].map((c) => (
                    <th key={c} className="px-2 py-1.5 text-right font-medium">{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="font-mono">
                {log.map((g) => (
                  <tr key={g.date + g.opponent} className="border-t border-white/5">
                    <td className="px-2 py-1.5 font-sans">{dateLabel(g.date)}</td>
                    <td className="px-2 py-1.5 font-sans">{g.home ? "vs" : "@"} {g.opponent}</td>
                    <td className={`px-2 py-1.5 font-sans ${g.result === "W" ? "text-emerald-400" : g.result === "L" ? "text-red-400" : "text-white/40"}`}>
                      {g.result ? `${g.result} ${g.teamScore}–${g.oppScore}` : "—"}
                    </td>
                    {[g.min, g.pts, g.reb, g.ast, g.stl, g.blk, g.tov].map((v, i) => <td key={i} className="px-2 py-1.5 text-right">{v}</td>)}
                    <td className={`px-2 py-1.5 text-right ${g.fp >= expectedFp ? "text-emerald-400" : "text-red-400"}`}>{g.fp.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.length > 0 && <p className="mt-2 text-xs text-white/40">FP in green beats his expected {expectedFp.toFixed(1)}; red falls short.</p>}
      </section>
    </div>
  );
}
