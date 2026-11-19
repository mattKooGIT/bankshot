"use client";

import { useId, useState } from "react";
import { formatMoney } from "@/lib/format";
import { niceTicks, tickLabel } from "@/lib/chart-ticks";

// Single-series price line. Validated against the dark surface (#0b0d10):
// OKLCH lightness in band, >= 3:1 contrast.
const LINE = "#4f8ff7";
const W = 640, H = 220, PAD = { t: 12, r: 16, b: 24, l: 52 };

type Point = { night: number; price: number };

export function PriceChart({ points, title }: { points: Point[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  if (points.length < 2) {
    return (
      <div className="flex h-[220px] items-center justify-center rounded-lg border border-white/10 text-sm text-white/40">
        The chart starts after the first game night.
      </div>
    );
  }

  const prices = points.map((p) => p.price);
  const ticks = niceTicks(Math.min(...prices), Math.max(...prices));
  const [lo, hi] = [ticks[0], ticks[ticks.length - 1]];
  const x = (i: number) => PAD.l + (i / (points.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join("");
  const area = `${line}L${x(points.length - 1)},${H - PAD.b}L${x(0)},${H - PAD.b}Z`;
  const last = points.length - 1;
  const active = hover ?? null;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * (W - PAD.l - PAD.r);
    setHover(Math.max(0, Math.min(last, Math.round((px / (W - PAD.l - PAD.r)) * last))));
  }

  return (
    <figure>
      <figcaption className="mb-2 text-sm text-white/60">{title}</figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-describedby={tableId}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.06)" />
              <text x={PAD.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-white/40 text-[11px]">
                {tickLabel(t)}
              </text>
            </g>
          ))}
          <text x={PAD.l} y={H - 6} className="fill-white/40 text-[11px]">Night {points[0].night}</text>
          <text x={W - PAD.r} y={H - 6} textAnchor="end" className="fill-white/40 text-[11px]">Night {points[last].night}</text>

          <path d={area} fill={LINE} opacity={0.1} />
          <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={x(last)} cy={y(points[last].price)} r={4} fill={LINE} stroke="#0b0d10" strokeWidth={2} />

          {active !== null && (
            <g pointerEvents="none">
              <line x1={x(active)} x2={x(active)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.3)" />
              <circle cx={x(active)} cy={y(points[active].price)} r={4} fill={LINE} stroke="#0b0d10" strokeWidth={2} />
            </g>
          )}
          {/* Hit area is the whole plot so readers aim at a night, not a 2px line. */}
          <rect
            x={PAD.l} y={PAD.t} width={W - PAD.l - PAD.r} height={H - PAD.t - PAD.b} fill="transparent"
            onPointerMove={onMove} onPointerLeave={() => setHover(null)}
          />
        </svg>
        {active !== null && (
          <div
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-white/10 bg-[#15181d] px-2 py-1 text-xs shadow"
            style={{ left: `${(x(active) / W) * 100}%` }}
          >
            <div className="text-white/50">Night {points[active].night}</div>
            <div className="font-mono text-white">{formatMoney(points[active].price)}</div>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs text-white/50">
        <summary className="cursor-pointer hover:text-white/80">Show data</summary>
        <table id={tableId} className="mt-2 w-full max-w-xs font-mono">
          <thead><tr><th className="text-left font-normal">Night</th><th className="text-right font-normal">Price</th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.night}><td>{p.night}</td><td className="text-right">{formatMoney(p.price)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
