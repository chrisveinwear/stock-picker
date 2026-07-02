import { describe, it, expect } from "vitest";
import { computeTechnicals, rsi, macd } from "./technicals";
import type { PriceHistory } from "./yahoo-finance";

const day = (i: number): string => {
  const d = new Date(Date.UTC(2025, 0, 1));
  d.setUTCDate(d.getUTCDate() + i);
  return d.toISOString().slice(0, 10);
};

const series = (closes: number[], volume = 1000): PriceHistory[] =>
  closes.map((close, i) => ({ date: day(i), close, volume }));

describe("rsi", () => {
  it("is 100 for a monotonic uptrend and ~0 for a downtrend", () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 30 }, (_, i) => 100 - i);
    expect(rsi(up)).toBe(100);
    expect(rsi(down)!).toBeLessThan(1);
  });
  it("is neutral (50) for a flat series", () => {
    expect(rsi(Array(30).fill(100))).toBe(50);
  });
  it("needs at least n+1 points", () => {
    expect(rsi([1, 2, 3])).toBeNull();
  });
});

describe("macd", () => {
  it("reads bullish after an upturn and bearish after a downturn", () => {
    // MACD is a momentum-change signal, so test a regime turn, not a steady trend.
    const turnedUp = [
      ...Array.from({ length: 90 }, (_, i) => 100 - i * 0.2),
      ...Array.from({ length: 30 }, (_, i) => 82 + i * 0.8),
    ];
    const turnedDown = [
      ...Array.from({ length: 90 }, (_, i) => 100 + i * 0.2),
      ...Array.from({ length: 30 }, (_, i) => 118 - i * 0.8),
    ];
    expect(macd(turnedUp)!.state).toBe("bullish");
    expect(macd(turnedDown)!.state).toBe("bearish");
  });
  it("needs a warm-up window", () => {
    expect(macd([1, 2, 3])).toBeNull();
  });
});

describe("computeTechnicals", () => {
  it("returns null when the series is too short", () => {
    expect(computeTechnicals(series(Array.from({ length: 30 }, (_, i) => 100 + i)))).toBeNull();
  });

  it("computes SMAs, range and levels on a steady uptrend", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.5);
    const t = computeTechnicals(series(closes))!;
    const last = closes[closes.length - 1];
    expect(t.close).toBe(last);
    // In an uptrend the price sits above every SMA and 50 > 200.
    expect(t.sma50!).toBeLessThan(last);
    expect(t.sma200!).toBeLessThan(t.sma50!);
    expect(t.goldenCross).toBe(true);
    expect(t.pctVsSma50!).toBeGreaterThan(0);
    // 52w high is the last close; support levels are the window minima.
    expect(t.high52w).toBe(last);
    expect(t.support3m).toBeCloseTo(closes[closes.length - 63], 10);
    expect(t.rsi14).toBe(100);
    expect(t.macd!.state).toBe("bullish");
    expect(t.return3mPct!).toBeGreaterThan(0);
  });

  it("sorts an unsorted series before computing", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.5);
    const shuffled = [...series(closes)].reverse();
    const t = computeTechnicals(shuffled)!;
    expect(t.close).toBe(closes[closes.length - 1]);
  });
});
