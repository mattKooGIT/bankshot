/** Round-number axis ticks whose range always contains [min, max] (at least 2 ticks). */
export function niceTicks(min: number, max: number, count = 4) {
  const span = max - min || 1;
  const step = 10 ** Math.floor(Math.log10(span / count));
  const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => span / s <= count) ?? step * 10;
  const start = Math.floor(min / nice) * nice;
  const ticks: number[] = [];
  // Keep going until a tick sits at or above max, so the line never leaves the plot.
  for (let i = 0; ; i++) {
    const v = Number((start + i * nice).toFixed(2));
    ticks.push(v);
    if (v >= max - nice * 1e-6 && ticks.length >= 2) return ticks;
  }
}

/** "$40", "$32.50", "$5.00": whole dollars only when the tick is whole and ≥ $10. */
export const tickLabel = (t: number) => `$${t.toFixed(t >= 10 && Number.isInteger(t) ? 0 : 2)}`;
