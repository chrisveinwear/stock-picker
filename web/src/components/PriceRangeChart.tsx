"use client";
import { useMemo } from "react";

export type LensPrice = {
  name: string;
  buyBelow: number;
  fairValue?: number;
  sellAbove: number;
};

type Props = {
  lenses: LensPrice[];
  consensusBuyBelow: number;
  consensusSellAbove: number;
  currentPrice?: number | null;
  currency?: string;
  mini?: boolean;
};

export default function PriceRangeChart({
  lenses,
  consensusBuyBelow,
  consensusSellAbove,
  currentPrice,
  currency = "$",
  mini = false,
}: Props) {
  const { minVal, range } = useMemo(() => {
    const allBuy = [...lenses.map((l) => l.buyBelow), consensusBuyBelow];
    const allSell = [...lenses.map((l) => l.sellAbove), consensusSellAbove];
    const lo = Math.min(...allBuy);
    const hi = Math.max(...allSell);
    const pad = (hi - lo) * 0.2;
    return { minVal: lo - pad, maxVal: hi + pad, range: hi - lo + pad * 2 };
  }, [lenses, consensusBuyBelow, consensusSellAbove]);

  // Consensus fair value = average of all lens fairValues
  const consensusFairValue = useMemo(() => {
    const fvs = lenses.map((l) => l.fairValue).filter((v): v is number => v != null);
    if (!fvs.length) return undefined;
    return fvs.reduce((a, b) => a + b, 0) / fvs.length;
  }, [lenses]);

  const pct = (v: number) => Math.max(0, Math.min(100, ((v - minVal) / range) * 100));

  const fmt = (v: number) =>
    v >= 1000
      ? `${currency}${(v / 1000).toFixed(1)}k`
      : `${currency}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;

  const fvPctDiff =
    currentPrice != null && consensusFairValue != null && consensusFairValue > 0
      ? ((currentPrice - consensusFairValue) / consensusFairValue) * 100
      : null;

  if (mini) {
    const fvPct = consensusFairValue != null ? pct(consensusFairValue) : null;
    return (
      <div className="space-y-1.5">
        <div className="relative" style={{ height: 28 }}>
          <div className="absolute inset-0 rounded overflow-hidden flex">
            <div className="bg-emerald-900/80 h-full" style={{ width: `${pct(consensusBuyBelow)}%` }} />
            <div className="bg-amber-900/60 h-full" style={{ width: `${pct(consensusSellAbove) - pct(consensusBuyBelow)}%` }} />
            <div className="bg-red-900/60 h-full flex-1" />
          </div>
          {/* Fair value line */}
          {fvPct != null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-amber-400/80 z-10"
              style={{ left: `${fvPct}%` }}
            />
          )}
          {/* Current price line */}
          {currentPrice != null && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/90 z-20"
              style={{ left: `${pct(currentPrice)}%` }}
            />
          )}
          <div className="absolute inset-0 flex items-center justify-between px-1.5 text-[10px] pointer-events-none">
            <span className="text-emerald-400">&lt;{fmt(consensusBuyBelow)}</span>
            <span className="text-red-400">&gt;{fmt(consensusSellAbove)}</span>
          </div>
        </div>
        {fvPctDiff != null && (
          <p className={`text-[10px] ${fvPctDiff > 0 ? "text-red-400" : "text-emerald-400"}`}>
            {fvPctDiff > 0 ? "▲" : "▼"} {Math.abs(fvPctDiff).toFixed(1)}% {fvPctDiff > 0 ? "above" : "below"} fair value ({fmt(consensusFairValue!)})
          </p>
        )}
      </div>
    );
  }

  const axisPoints = [minVal, minVal + range * 0.25, minVal + range * 0.5, minVal + range * 0.75, minVal + range];
  // Vertical lines we'll draw: fair value (amber) and current price (white)
  const fvChartPct = consensusFairValue != null ? pct(consensusFairValue) : null;
  const currentPct = currentPrice != null ? pct(currentPrice) : null;

  return (
    <div className="w-full font-mono text-xs">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[11px] text-zinc-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-emerald-700" /> Buy zone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-amber-800" /> Hold zone
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-red-800" /> Sell zone
        </span>
        {consensusFairValue != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-0.5 h-3 bg-amber-400" /> Fair value
          </span>
        )}
        {currentPrice != null && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-0.5 h-3 bg-white/80" /> Current price
          </span>
        )}
      </div>

      {/* Grid: label col + bars col */}
      <div className="grid" style={{ gridTemplateColumns: "130px 1fr" }}>
        {/* Labels */}
        <div className="pr-3">
          {lenses.map((l) => (
            <div
              key={l.name}
              className="h-5 mb-1 flex items-center justify-end text-zinc-500 truncate leading-none"
            >
              {l.name}
            </div>
          ))}
          <div className="h-2" />
          <div className="h-8 flex items-center justify-end font-semibold text-zinc-200 leading-none">
            AI Consensus
          </div>
          {/* spacers for the indicator row + axis */}
          <div className="h-6" />
          <div className="h-5" />
        </div>

        {/* Bars column — position relative so vertical lines span all rows */}
        <div className="relative">
          {lenses.map((l) => (
            <div key={l.name} className="relative h-5 mb-1 rounded overflow-hidden">
              <div className="absolute inset-y-0 bg-emerald-700/60" style={{ left: 0, width: `${pct(l.buyBelow)}%` }} />
              <div
                className="absolute inset-y-0 bg-amber-800/70"
                style={{ left: `${pct(l.buyBelow)}%`, width: `${pct(l.sellAbove) - pct(l.buyBelow)}%` }}
              />
              <div className="absolute inset-y-0 bg-red-800/60" style={{ left: `${pct(l.sellAbove)}%`, right: 0 }} />
              {/* Per-lens fair value tick */}
              {l.fairValue && (
                <div
                  className="absolute inset-y-0 w-0.5 bg-amber-300/80"
                  style={{ left: `${pct(l.fairValue)}%` }}
                />
              )}
            </div>
          ))}

          <div className="h-2" />

          {/* Consensus bar */}
          <div className="relative h-8 rounded overflow-hidden">
            <div className="absolute inset-y-0 bg-emerald-800" style={{ left: 0, width: `${pct(consensusBuyBelow)}%` }} />
            <div
              className="absolute inset-y-0 bg-amber-800/70"
              style={{ left: `${pct(consensusBuyBelow)}%`, width: `${pct(consensusSellAbove) - pct(consensusBuyBelow)}%` }}
            />
            <div className="absolute inset-y-0 bg-red-900" style={{ left: `${pct(consensusSellAbove)}%`, right: 0 }} />
            {pct(consensusBuyBelow) > 18 && (
              <span
                className="absolute inset-y-0 flex items-center pl-2 text-emerald-300 text-[11px] font-semibold pointer-events-none"
                style={{ left: 0, width: `${pct(consensusBuyBelow)}%` }}
              >
                Buy &lt; {fmt(consensusBuyBelow)}
              </span>
            )}
            {pct(consensusSellAbove) < 85 && (
              <span
                className="absolute inset-y-0 flex items-center pl-2 text-red-300 text-[11px] font-semibold pointer-events-none"
                style={{ left: `${pct(consensusSellAbove)}%` }}
              >
                Sell &gt; {fmt(consensusSellAbove)}
              </span>
            )}
          </div>

          {/* ── FV vs Current indicator row ── */}
          <div className="relative h-6 mt-0.5">
            {fvPctDiff != null && fvChartPct != null && currentPct != null && (
              <>
                {/* Horizontal bracket between FV and current */}
                <div
                  className={`absolute top-1/2 h-px ${fvPctDiff > 0 ? "bg-red-500/60" : "bg-emerald-500/60"}`}
                  style={{
                    left: `${Math.min(fvChartPct, currentPct)}%`,
                    width: `${Math.abs(currentPct - fvChartPct)}%`,
                  }}
                />
                {/* Percentage label at midpoint */}
                <span
                  className={`absolute -translate-x-1/2 -translate-y-1/2 top-1/2 text-[10px] font-semibold px-1 rounded ${
                    fvPctDiff > 0 ? "text-red-400 bg-red-950/80" : "text-emerald-400 bg-emerald-950/80"
                  }`}
                  style={{ left: `${(fvChartPct + currentPct) / 2}%` }}
                >
                  {fvPctDiff > 0 ? "+" : ""}{fvPctDiff.toFixed(1)}% vs FV
                </span>
              </>
            )}
          </div>

          {/* X-axis */}
          <div className="h-5 relative">
            {axisPoints.map((v, i) => (
              <span
                key={i}
                className="absolute text-zinc-600 text-[10px]"
                style={{ left: `${pct(v)}%`, transform: "translateX(-50%)" }}
              >
                {fmt(v)}
              </span>
            ))}
          </div>

          {/* ── Vertical lines — span from top of first bar to bottom of consensus bar ── */}
          {/* Heights: lenses*(h-5=20 + mb-1=4) + h-2=8 separator + h-8=32 consensus = lenses*24 + 40 */}
          {(() => {
            const spanHeight = lenses.length * 24 + 40;
            return (
              <>
                {/* Fair value line (amber) — label at top, pushed further up so it clears the current price label */}
                {fvChartPct != null && (
                  <div
                    className="absolute top-0 w-0.5 bg-amber-400/90 pointer-events-none z-10"
                    style={{ left: `${fvChartPct}%`, height: spanHeight }}
                  >
                    <div className="absolute bottom-full mb-6 -translate-x-1/2 bg-amber-900 border border-amber-600 rounded px-1.5 py-0.5 text-amber-200 text-[10px] whitespace-nowrap">
                      FV {fmt(consensusFairValue!)}
                    </div>
                  </div>
                )}
                {/* Current price line (white) — label immediately above bars */}
                {currentPct != null && (
                  <div
                    className="absolute top-0 w-0.5 bg-white/85 pointer-events-none z-20"
                    style={{ left: `${currentPct}%`, height: spanHeight }}
                  >
                    <div className="absolute bottom-full mb-1 -translate-x-1/2 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-white text-[10px] whitespace-nowrap">
                      {fmt(currentPrice!)}
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
