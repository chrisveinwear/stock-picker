/**
 * Deterministic technical indicators, computed in code from a DAILY close series.
 * This exists so research reports never invent RSI/MACD/moving-average readings:
 * the generation route computes these and injects them as the authoritative
 * technical picture (see the Citadel lens). Pure maths — no I/O.
 */
import type { PriceHistory } from "@/lib/yahoo-finance";

export type MacdReading = {
  macd: number;
  signal: number;
  histogram: number;
  state: "bullish" | "bearish"; // MACD line above/below signal line
};

export type TechnicalReading = {
  asOf: string;
  close: number;
  sma50: number | null;
  sma100: number | null;
  sma200: number | null;
  pctVsSma50: number | null;
  pctVsSma100: number | null;
  pctVsSma200: number | null;
  goldenCross: boolean | null; // sma50 > sma200
  rsi14: number | null;
  macd: MacdReading | null;
  high52w: number;
  low52w: number;
  support3m: number;  // 3-month closing low
  resistance3m: number; // 3-month closing high
  support6m: number;
  resistance6m: number;
  /** Avg daily volume last ~1 month vs the prior ~3 months, as a ratio. */
  volumeRatio1mVs3m: number | null;
  return3mPct: number | null;
  return1yPct: number | null;
};

const sma = (closes: number[], n: number): number | null => {
  if (closes.length < n) return null;
  const w = closes.slice(-n);
  return w.reduce((s, v) => s + v, 0) / n;
};

const emaSeries = (values: number[], n: number): number[] => {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev = values[0];
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
};

/** Wilder's RSI over the last `n` periods; null if insufficient data. */
export function rsi(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / n;
  let avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgGain === 0 && avgLoss === 0) return 50; // flat series — neutral, not overbought
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** MACD(12,26,9) on the close series; null if insufficient data. */
export function macd(closes: number[]): MacdReading | null {
  if (closes.length < 35) return null;
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = emaSeries(macdLine.slice(25), 9); // start after ema26 warm-up
  const m = macdLine[macdLine.length - 1];
  const s = signalLine[signalLine.length - 1];
  return { macd: m, signal: s, histogram: m - s, state: m >= s ? "bullish" : "bearish" };
}

/**
 * Compute the full reading from a daily series (ascending by date). Needs ~60
 * trading days minimum; longer-window fields are null when data is short.
 */
export function computeTechnicals(daily: PriceHistory[]): TechnicalReading | null {
  const series = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  if (series.length < 60) return null;
  const closes = series.map((p) => p.close);
  const last = series[series.length - 1];

  const year = series.slice(-252);
  const threeMo = series.slice(-63);
  const sixMo = series.slice(-126);

  const s50 = sma(closes, 50);
  const s100 = sma(closes, 100);
  const s200 = sma(closes, 200);
  const pctVs = (m: number | null) => (m != null && m > 0 ? ((last.close - m) / m) * 100 : null);

  const vols = series.map((p) => p.volume).filter((v) => v > 0);
  let volumeRatio: number | null = null;
  if (vols.length >= 84) {
    const last21 = vols.slice(-21);
    const prior63 = vols.slice(-84, -21);
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    const p = avg(prior63);
    volumeRatio = p > 0 ? avg(last21) / p : null;
  }

  const ret = (from: PriceHistory[] | undefined) => {
    const first = from?.[0];
    return first && first.close > 0 ? ((last.close - first.close) / first.close) * 100 : null;
  };

  return {
    asOf: last.date,
    close: last.close,
    sma50: s50,
    sma100: s100,
    sma200: s200,
    pctVsSma50: pctVs(s50),
    pctVsSma100: pctVs(s100),
    pctVsSma200: pctVs(s200),
    goldenCross: s50 != null && s200 != null ? s50 > s200 : null,
    rsi14: rsi(closes.slice(-120)), // Wilder smoothing over recent window
    macd: macd(closes),
    high52w: Math.max(...year.map((p) => p.close)),
    low52w: Math.min(...year.map((p) => p.close)),
    support3m: Math.min(...threeMo.map((p) => p.close)),
    resistance3m: Math.max(...threeMo.map((p) => p.close)),
    support6m: Math.min(...sixMo.map((p) => p.close)),
    resistance6m: Math.max(...sixMo.map((p) => p.close)),
    volumeRatio1mVs3m: volumeRatio,
    return3mPct: ret(threeMo),
    return1yPct: ret(year),
  };
}

/** Render the reading as an authoritative prompt block for the Citadel lens. */
export function formatTechnicalsForPrompt(t: TechnicalReading, currency: string): string {
  const n = (v: number | null, d = 2) => (v == null ? "n/a" : v.toFixed(d));
  const pct = (v: number | null) => (v == null ? "n/a" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
  const maLine = (label: string, m: number | null, p: number | null) =>
    m == null ? `- ${label}: n/a (insufficient history)` : `- ${label}: ${currency} ${n(m)} (price ${pct(p)} vs it)`;

  return `\n\n## Computed Technicals (authoritative — as of ${t.asOf}, daily closes)

These indicator values were COMPUTED in code from the actual price series. In the technical-analysis section you MUST use these exact readings — do NOT invent, estimate, or "approximate" any indicator value, chart pattern, or volume claim that is not derivable from the figures below.

- Last close: ${currency} ${n(t.close)} · 3m return ${pct(t.return3mPct)} · 1y return ${pct(t.return1yPct)}
${maLine("50-day SMA", t.sma50, t.pctVsSma50)}
${maLine("100-day SMA", t.sma100, t.pctVsSma100)}
${maLine("200-day SMA", t.sma200, t.pctVsSma200)}
- 50/200 relationship: ${t.goldenCross == null ? "n/a" : t.goldenCross ? "50-day ABOVE 200-day (golden-cross regime)" : "50-day BELOW 200-day (death-cross regime)"}
- RSI(14): ${n(t.rsi14, 1)}
- MACD(12,26,9): line ${n(t.macd?.macd ?? null, 3)} vs signal ${n(t.macd?.signal ?? null, 3)} → ${t.macd?.state ?? "n/a"} (histogram ${n(t.macd?.histogram ?? null, 3)})
- 52-week range: ${currency} ${n(t.low52w)} – ${n(t.high52w)}
- Support (3m/6m closing lows): ${currency} ${n(t.support3m)} / ${n(t.support6m)} · Resistance (3m/6m closing highs): ${currency} ${n(t.resistance3m)} / ${n(t.resistance6m)}
- Volume: last-month avg daily volume is ${t.volumeRatio1mVs3m == null ? "n/a" : `${n(t.volumeRatio1mVs3m, 2)}x`} the prior-3-month average`;
}
