/**
 * Report history — the persistent memory layer.
 *
 * Every research report already accumulates as a dated row in `research_reports`
 * (the generate route never overwrites a different date). This module turns that
 * accumulated series into (a) prompt context so each new report is aware of how
 * the thesis and valuation have evolved, and (b) a material-change detector that
 * feeds the alert log.
 */
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export type ReportSnapshot = {
  reportDate: string;
  verdict: string | null;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  marginOfSafety: number | null;
  buyBelow: number | null;
  sellAbove: number | null;
};

/** Midpoint intrinsic value, the single number we track as "fair value" over time. */
export function fairValue(s: {
  intrinsicValueLow?: number | null;
  intrinsicValueHigh?: number | null;
}): number | null {
  const lo = s.intrinsicValueLow;
  const hi = s.intrinsicValueHigh;
  if (lo != null && hi != null) return (lo + hi) / 2;
  return hi ?? lo ?? null;
}

/** Prior reports for a ticker, newest first, optionally excluding a given date. */
export function getReportHistory(
  ticker: string,
  opts?: { limit?: number; excludeDate?: string }
): ReportSnapshot[] {
  const db = getDb();
  const rows = db
    .select({
      reportDate: researchReports.reportDate,
      verdict: researchReports.verdict,
      intrinsicValueLow: researchReports.intrinsicValueLow,
      intrinsicValueHigh: researchReports.intrinsicValueHigh,
      marginOfSafety: researchReports.marginOfSafety,
      buyBelow: researchReports.buyBelow,
      sellAbove: researchReports.sellAbove,
    })
    .from(researchReports)
    .where(eq(researchReports.ticker, ticker))
    .orderBy(desc(researchReports.reportDate))
    .all();

  const filtered = opts?.excludeDate
    ? rows.filter((r) => r.reportDate !== opts.excludeDate)
    : rows;
  return opts?.limit ? filtered.slice(0, opts.limit) : filtered;
}

/** The single most-recent prior report for a ticker (excluding today's, if given). */
export function getPreviousReport(
  ticker: string,
  excludeDate?: string
): ReportSnapshot | null {
  return getReportHistory(ticker, { limit: 1, excludeDate })[0] ?? null;
}

/**
 * Render prior reports as a compact "Historical Context" block for the prompt.
 * Returns "" when there's no history, so callers can append unconditionally.
 */
export function formatHistoryForPrompt(ticker: string, limit = 6): string {
  const history = getReportHistory(ticker, { limit });
  if (!history.length) return "";

  const lines = history.map((h) => {
    const fv = fairValue(h);
    const parts = [
      h.reportDate,
      h.verdict ? `verdict=${h.verdict}` : null,
      fv != null ? `fairValue=${fv.toFixed(2)}` : null,
      h.intrinsicValueLow != null && h.intrinsicValueHigh != null
        ? `IV=${h.intrinsicValueLow}–${h.intrinsicValueHigh}`
        : null,
      h.buyBelow != null ? `buyBelow=${h.buyBelow}` : null,
      h.sellAbove != null ? `sellAbove=${h.sellAbove}` : null,
      h.marginOfSafety != null ? `MOS=${h.marginOfSafety}%` : null,
    ].filter(Boolean);
    return `- ${parts.join(" · ")}`;
  });

  return `\n\n## Historical Context — prior reports for ${ticker}

These are this asset's own previous research reports (newest first). Treat them as institutional memory: note how the verdict, fair value and margin of safety have drifted, comment explicitly on any change in your thesis versus the last report, and explain whether the change in fair value is justified by new fundamentals or is just estimate noise.

${lines.join("\n")}`;
}

export type MaterialChange = {
  kind: "verdict_change" | "fv_change";
  detail: string;
  previousFairValue: number | null;
  newFairValue: number | null;
  changePct: number | null; // signed % change in fair value
};

/** % move in fair value beyond which we consider it material. */
export const FV_MATERIAL_PCT = 10;

/**
 * Compare a freshly-generated report against the previous one and return any
 * material changes worth alerting on (verdict flip, or fair value move ≥ threshold).
 */
export function detectMaterialChange(
  prev: ReportSnapshot | null,
  curr: {
    verdict?: string | null;
    intrinsicValueLow?: number | null;
    intrinsicValueHigh?: number | null;
  },
  opts?: { fvThresholdPct?: number }
): MaterialChange[] {
  if (!prev) return []; // first ever report — nothing to compare against
  const threshold = opts?.fvThresholdPct ?? FV_MATERIAL_PCT;
  const changes: MaterialChange[] = [];

  const prevFv = fairValue(prev);
  const newFv = fairValue(curr);

  if (prev.verdict && curr.verdict && prev.verdict !== curr.verdict) {
    changes.push({
      kind: "verdict_change",
      detail: `Verdict changed ${prev.verdict} → ${curr.verdict}`,
      previousFairValue: prevFv,
      newFairValue: newFv,
      changePct: prevFv && newFv ? ((newFv - prevFv) / prevFv) * 100 : null,
    });
  }

  if (prevFv != null && newFv != null && prevFv !== 0) {
    const pct = ((newFv - prevFv) / prevFv) * 100;
    if (Math.abs(pct) >= threshold) {
      changes.push({
        kind: "fv_change",
        detail: `Fair value ${pct >= 0 ? "up" : "down"} ${Math.abs(pct).toFixed(1)}% (${prevFv.toFixed(2)} → ${newFv.toFixed(2)})`,
        previousFairValue: prevFv,
        newFairValue: newFv,
        changePct: pct,
      });
    }
  }

  return changes;
}

/** Full fair-value / verdict time series for a ticker, oldest first (for charting). */
export function getFairValueSeries(ticker: string): {
  date: string;
  verdict: string | null;
  fairValue: number | null;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  buyBelow: number | null;
  sellAbove: number | null;
  marginOfSafety: number | null;
}[] {
  return getReportHistory(ticker)
    .map((h) => ({
      date: h.reportDate,
      verdict: h.verdict,
      fairValue: fairValue(h),
      intrinsicValueLow: h.intrinsicValueLow,
      intrinsicValueHigh: h.intrinsicValueHigh,
      buyBelow: h.buyBelow,
      sellAbove: h.sellAbove,
      marginOfSafety: h.marginOfSafety,
    }))
    .reverse();
}
