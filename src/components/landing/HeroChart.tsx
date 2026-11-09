/** Decorative market line in hardwood, drawn once on load. */
export function HeroChart({ points }: { points: number[] }) {
  const W = 1000, H = 320;
  const lo = Math.min(...points), hi = Math.max(...points);
  const span = hi - lo || 1;
  const xy = points.map((v, i) => [
    (i / Math.max(1, points.length - 1)) * W,
    H - 30 - ((v - lo) / span) * (H - 80),
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  return (
    <svg aria-hidden viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 -z-10 h-[48%] w-full">
      <defs>
        <linearGradient id="hardwood-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#d9a05b" stopOpacity="0.12" />
          <stop offset="1" stopColor="#d9a05b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line}L${W},${H}L0,${H}Z`} fill="url(#hardwood-fade)" className="chart-fade" />
      <path d={line} pathLength={1} fill="none" stroke="#d9a05b" strokeWidth={2} strokeOpacity={0.5}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" className="chart-draw" />
    </svg>
  );
}
