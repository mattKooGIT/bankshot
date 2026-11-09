"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Player } from "@/lib/market";
import { formatMoney, formatPct } from "@/lib/format";

type SortKey = "price" | "change" | "expected_fp" | "name";
const POSITIONS = ["All", "G", "F", "C"] as const;

export function MarketTable({ players }: { players: Player[] }) {
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>("All");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "price", desc: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const value = (p: Player) =>
      sort.key === "change" ? (p.last_move?.total ?? 0) : sort.key === "name" ? p.name : p[sort.key];
    return players
      .filter((p) => pos === "All" || p.position === pos)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.ticker.toLowerCase().includes(q) || p.team?.toLowerCase() === q)
      .sort((a, b) => {
        const [x, y] = [value(a), value(b)];
        const c = typeof x === "string" ? x.localeCompare(y as string) : (x as number) - (y as number);
        return sort.desc ? -c : c;
      });
  }, [players, query, pos, sort]);

  const header = (key: SortKey, label: string, align = "text-right") => (
    <th className={`px-3 py-2 font-medium ${align}`}>
      <button
        onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== "name" }))}
        className="hover:text-white"
      >
        {label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search player, ticker, or team (e.g. LAL)" aria-label="Search players"
          className="w-full max-w-xs rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
        />
        <div className="flex rounded-lg border border-white/15 p-0.5 text-sm" role="group" aria-label="Filter by position">
          {POSITIONS.map((p) => (
            <button key={p} onClick={() => setPos(p)}
              className={`rounded-md px-3 py-1 ${pos === p ? "bg-white/15 text-white" : "text-white/60 hover:text-white"}`}>
              {p}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-white/40">{rows.length} players</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="w-full text-sm">
          <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-white/50">
            <tr>
              {header("name", "Player", "text-left")}
              <th className="px-3 py-2 font-medium">Pos</th>
              {header("expected_fp", "Exp. FP")}
              {header("price", "Price")}
              {header("change", "Last night")}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const change = p.last_move?.total ?? 0;
              return (
                <tr key={p.ticker} className="border-t border-white/5 hover:bg-white/[0.03]">
                  <td className="px-3 py-2">
                    <Link href={`/players/${p.ticker}`} className="flex items-baseline gap-2">
                      <span className="w-24 shrink-0 font-mono font-semibold text-emerald-300">{p.ticker}</span>
                      <span>{p.name}</span>
                      {p.team && <span className="text-xs text-white/40">{p.team}</span>}
                      {p.out_nights > 0 && (
                        <span className="rounded bg-red-500/15 px-1.5 text-[10px] font-semibold uppercase text-red-300">Out</span>
                      )}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-white/60">{p.position}</td>
                  <td className="px-3 py-2 text-right font-mono text-white/70">{p.expected_fp.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{formatMoney(p.price)}</td>
                  <td className={`px-3 py-2 text-right font-mono ${change > 0 ? "text-emerald-400" : change < 0 ? "text-red-400" : "text-white/40"}`}>
                    {p.last_move ? formatPct(change) : "—"}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-white/40">No players match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
