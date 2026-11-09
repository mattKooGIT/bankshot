const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** Supabase returns Postgres numeric columns as strings or numbers; accept both. */
export function formatMoney(value: number | string | null | undefined) {
  return money.format(Number(value ?? 0));
}

export function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}
