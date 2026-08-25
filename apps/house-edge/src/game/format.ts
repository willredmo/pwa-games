const SUFFIXES = [
  "", "k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc",
];

/** Compact magnitudes: 1.23k, 45.6M, 7.89Qa. Currency-free. */
export function fmt(n: number): string {
  if (!isFinite(n)) return "∞";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  if (v < 1000) return sign + (v < 10 && !Number.isInteger(v) ? v.toFixed(1) : Math.floor(v).toString());
  const tier = Math.min(Math.floor(Math.log10(v) / 3), SUFFIXES.length - 1);
  const scaled = v / Math.pow(1000, tier);
  return `${sign}${scaled.toFixed(scaled < 100 ? 2 : 0)}${SUFFIXES[tier]}`;
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * The bankroll and everything priced against it. Ivory is a separate currency
 * and is deliberately *not* formatted through here — it is a prestige token,
 * not money, and showing it with a dollar sign would imply you could bet it.
 */
export function money(n: number): string {
  const s = fmt(n);
  return s.startsWith("-") ? `-$${s.slice(1)}` : `$${s}`;
}
