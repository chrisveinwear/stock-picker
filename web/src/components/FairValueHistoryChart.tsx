"use client";
import { useEffect, useMemo, useState } from "react";

type FvPoint = {
  date: string;
  verdict: string | null;
  fairValue: number | null;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  buyBelow: number | null;
  sellAbove: number | null;
};

type PricePoint = { date: string; close: number };

type Props = {
  ticker: string;
  isCommodity?: boolean;
  currency?: string;
};

const verdictColor: Record<string, string> = {
  buy: "#34d399", // emerald-400
  watch: "#fbbf24", // amber-400
  hold: "#60a5fa", // blue-400
  avoid: "#f87171", // red-400
};

const ms = (d: string) => new Date(`${d}T00:00:00Z`).getTime();

function pickPeriod(oldest: string | undefined): "1y" | "2y" | "5y" {
  if (!oldest) return "1y";
  const ageDays = (Date.now() - ms(oldest)) / 86_400_000;
  if (ageDays > 730) return "5y";
  if (ageDays > 365) return "2y";
  return "1y";
}

export default function FairValueHistoryChart({ ticker, isCommodity, currency = "$" }: Props) {
  const [fv, setFv] = useState<FvPoint[] | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      setLoading(true);
      try {
        const hRes = await fetch(`/api/research/history?ticker=${encodeURIComponent(ticker)}`, {
          signal: ac.signal,
        });
        const hJson = await hRes.json();
        const series: FvPoint[] = hJson.series ?? [];
        setFv(series);

        // Span the window back to the oldest report. Equities use the Yahoo
        // ticker; commodities resolve to a futures symbol server-side, with the
        // series converted to AUD when the report is AUD-denominated.
        const period = pickPeriod(series[0]?.date);
        const url = isCommodity
          ? `/api/prices/commodity-history?commodity=${encodeURIComponent(ticker)}&period=${period}&currency=${currency.includes("US") ? "usd" : "aud"}`
          : `/api/prices/history?ticker=${encodeURIComponent(ticker)}&period=${period}`;
        const pRes = await fetch(url, { signal: ac.signal });
        const pJson = await pRes.json();
        if (Array.isArray(pJson)) {
          setPrices(pJson.map((p: PricePoint) => ({ date: p.date, close: p.close })));
        }
      } catch {
        /* aborted or failed — render whatever we have */
      } finally {
        setLoading(false);
      }
    })();
    return () => ac.abort();
  }, [ticker, isCommodity, currency]);

  const fmt = (v: number) =>
    v >= 1000 ? `${currency}${(v / 1000).toFixed(1)}k` : `${currency}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString("en-AU", { month: "short", year: "2-digit" });

  // ── Layout & scales ──────────────────────────────────────────────────────
  const W = 720;
  const H = 300;
  const m = { top: 16, right: 16, bottom: 28, left: 52 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const geom = useMemo(() => {
    if (!fv || fv.length === 0) return null;

    const fvPoints = fv
      .filter((p) => p.fairValue != null)
      .map((p) => ({ ...p, t: ms(p.date) }));
    const ivPoints = fv
      .filter((p) => p.intrinsicValueLow != null && p.intrinsicValueHigh != null)
      .map((p) => ({ t: ms(p.date), low: p.intrinsicValueLow as number, high: p.intrinsicValueHigh as number }));
    const pricePoints = prices.map((p) => ({ t: ms(p.date), close: p.close }));

    const allT = [
      ...fvPoints.map((p) => p.t),
      ...pricePoints.map((p) => p.t),
      Date.now(),
    ];
    let t0 = Math.min(...allT);
    let t1 = Math.max(...allT);
    if (t0 === t1) {
      t0 -= 15 * 86_400_000;
      t1 += 15 * 86_400_000;
    }

    const allV = [
      ...fvPoints.map((p) => p.fairValue as number),
      ...ivPoints.flatMap((p) => [p.low, p.high]),
      ...pricePoints.map((p) => p.close),
    ];
    let lo = Math.min(...allV);
    let hi = Math.max(...allV);
    const pad = (hi - lo || hi || 1) * 0.1;
    lo -= pad;
    hi += pad;

    const x = (t: number) => m.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (v: number) => m.top + (1 - (v - lo) / (hi - lo)) * innerH;

    const linePath = (pts: { t: number; v: number }[]) =>
      pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");

    const priceLine = linePath(pricePoints.map((p) => ({ t: p.t, v: p.close })));
    const fvLine = linePath(fvPoints.map((p) => ({ t: p.t, v: p.fairValue as number })));

    // IV band: polygon for ≥2 points, otherwise a full-width horizontal strip.
    let bandPath = "";
    let bandStrip: { y1: number; y2: number } | null = null;
    if (ivPoints.length >= 2) {
      const top = ivPoints.map((p) => `${x(p.t).toFixed(1)},${y(p.high).toFixed(1)}`);
      const bot = [...ivPoints].reverse().map((p) => `${x(p.t).toFixed(1)},${y(p.low).toFixed(1)}`);
      bandPath = `M${top.join(" L")} L${bot.join(" L")} Z`;
    } else if (ivPoints.length === 1) {
      bandStrip = { y1: y(ivPoints[0].high), y2: y(ivPoints[0].low) };
    }

    // Y gridlines
    const ticks = 4;
    const yTicks = Array.from({ length: ticks + 1 }, (_, i) => lo + ((hi - lo) * i) / ticks);

    return {
      x, y, t0, t1, lo, hi,
      fvPoints, pricePoints, priceLine, fvLine, bandPath, bandStrip, yTicks,
      hasPrice: pricePoints.length > 0,
      singleFv: fvPoints.length === 1 ? fvPoints[0] : null,
    };
  }, [fv, prices, innerW, innerH]);

  if (loading) {
    return <div className="h-[200px] flex items-center justify-center text-zinc-600 text-sm">Loading history…</div>;
  }
  if (!geom || (geom.fvPoints.length === 0 && geom.pricePoints.length === 0)) {
    return (
      <p className="text-sm text-zinc-500">
        No history to chart yet. As monthly refreshes accumulate, fair-value estimates will plot here against price.
      </p>
    );
  }

  const onlyOneReport = fv && fv.length === 1;

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-[11px] text-zinc-500 flex-wrap">
        {geom.hasPrice && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 bg-white/80" /> Price
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 bg-amber-400" /> Fair value
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-2 rounded-sm bg-amber-500/20 border border-amber-500/40" /> IV range
        </span>
      </div>

      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 320 }} role="img"
             aria-label={`Price vs fair value over time for ${ticker}`}>
          {/* Y gridlines + labels */}
          {geom.yTicks.map((v, i) => (
            <g key={i}>
              <line x1={m.left} x2={W - m.right} y1={geom.y(v)} y2={geom.y(v)} stroke="#27272a" strokeWidth={1} />
              <text x={m.left - 8} y={geom.y(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="#71717a">
                {fmt(v)}
              </text>
            </g>
          ))}

          {/* X labels at each report date */}
          {geom.fvPoints.map((p, i) => (
            <text key={i} x={geom.x(p.t)} y={H - 8} textAnchor="middle" fontSize={10} fill="#71717a">
              {fmtDate(p.t)}
            </text>
          ))}

          {/* IV band */}
          {geom.bandPath && <path d={geom.bandPath} fill="rgba(245,158,11,0.14)" stroke="none" />}
          {geom.bandStrip && (
            <rect
              x={m.left}
              width={innerW}
              y={Math.min(geom.bandStrip.y1, geom.bandStrip.y2)}
              height={Math.abs(geom.bandStrip.y2 - geom.bandStrip.y1)}
              fill="rgba(245,158,11,0.12)"
            />
          )}

          {/* Price line */}
          {geom.hasPrice && <path d={geom.priceLine} fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} />}

          {/* Fair value: line for ≥2 points, dashed reference line for a single point */}
          {geom.singleFv ? (
            <line
              x1={m.left} x2={W - m.right}
              y1={geom.y(geom.singleFv.fairValue as number)} y2={geom.y(geom.singleFv.fairValue as number)}
              stroke="#fbbf24" strokeWidth={1.5} strokeDasharray="5 4"
            />
          ) : (
            <path d={geom.fvLine} fill="none" stroke="#fbbf24" strokeWidth={1.75} />
          )}

          {/* Fair value markers, coloured by verdict */}
          {geom.fvPoints.map((p, i) => (
            <circle
              key={i}
              cx={geom.x(p.t)}
              cy={geom.y(p.fairValue as number)}
              r={3.5}
              fill={(p.verdict && verdictColor[p.verdict]) || "#fbbf24"}
              stroke="#18181b"
              strokeWidth={1}
            >
              <title>
                {p.date} — {p.verdict ?? "?"} · FV {fmt(p.fairValue as number)}
                {p.intrinsicValueLow != null && p.intrinsicValueHigh != null
                  ? ` (IV ${fmt(p.intrinsicValueLow)}–${fmt(p.intrinsicValueHigh)})`
                  : ""}
              </title>
            </circle>
          ))}
        </svg>
      </div>

      {onlyOneReport && (
        <p className="text-[11px] text-zinc-600 mt-2">
          Only one report so far — the fair-value line is flat. It fills out as monthly refreshes accumulate.
        </p>
      )}
    </div>
  );
}
