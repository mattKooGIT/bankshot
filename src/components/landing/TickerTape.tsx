import { formatMoney, formatPct } from "@/lib/format";

export type TapeItem = { ticker: string; price: number; change: number | null };

function Row({ items, reverse }: { items: TapeItem[]; reverse?: boolean }) {
  // Items are rendered twice so the -50% translate loops seamlessly.
  return (
    <div className="overflow-hidden">
      <div className={`tape flex w-max gap-10 py-2 ${reverse ? "tape-reverse" : ""}`}>
        {[...items, ...items].map((t, i) => (
          <span key={i} className="flex items-baseline gap-2 whitespace-nowrap text-sm tabular-nums">
            <span className="font-semibold text-white/80">{t.ticker}</span>
            <span className="text-white/55">{formatMoney(t.price)}</span>
            {t.change !== null && (
              <span className={t.change > 0 ? "text-emerald-400/80" : t.change < 0 ? "text-red-400/80" : "text-white/40"}>
                {t.change > 0 ? "▲" : t.change < 0 ? "▼" : ""}{formatPct(Math.abs(t.change)).replace("+", "")}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Decorative: two rows of real prices drifting in opposite directions. */
export function TickerTape({ items }: { items: TapeItem[] }) {
  const half = Math.ceil(items.length / 2);
  return (
    <div aria-hidden className="border-y border-white/10 bg-black/30 backdrop-blur-[2px]">
      <Row items={items.slice(0, half)} />
      <div className="border-t border-white/5" />
      <Row items={items.slice(half)} reverse />
    </div>
  );
}
