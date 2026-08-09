import { getDb } from "@/db";
import { watchlist } from "@/db/schema";

export type ReportLike = {
  ticker: string;
  companyName?: string | null;
  intrinsicValueLow?: number | null;
  intrinsicValueHigh?: number | null;
  buyBelow?: number | null;
};

/**
 * Add or refresh a watch-list row from a research report. The alert engine and
 * the zone views read thresholds from the latest report itself; the values
 * seeded here (IV midpoint, buy target) are display/fallback copies — so each
 * new report REFRESHES them on the existing row, otherwise the dashboard keeps
 * showing first-report numbers forever (CSL once showed IV $325 against a
 * current report midpoint of $132.50). Manual fields (whyWatching, sector,
 * alertEnabled, MOS threshold) are left untouched on update.
 */
export function addReportToWatchlist(report: ReportLike): void {
  const db = getDb();

  const iv =
    report.intrinsicValueLow != null && report.intrinsicValueHigh != null
      ? (report.intrinsicValueLow + report.intrinsicValueHigh) / 2
      : report.intrinsicValueHigh ?? report.intrinsicValueLow ?? null;

  db.insert(watchlist)
    .values({
      ticker: report.ticker,
      companyName: report.companyName ?? null,
      intrinsicValue: iv,
      targetBuyPrice: report.buyBelow ?? null,
      whyWatching: "Auto-added from research report",
    })
    .onConflictDoUpdate({
      target: watchlist.ticker,
      set: {
        companyName: report.companyName ?? null,
        intrinsicValue: iv,
        targetBuyPrice: report.buyBelow ?? null,
      },
    })
    .run();
}
