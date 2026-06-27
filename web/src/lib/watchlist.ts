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
 * Add a stock to the watch list from a research report. Idempotent — if the
 * ticker is already on the watch list, the existing row (and any manual edits)
 * is left untouched. The alert engine reads buy/sell thresholds from the report
 * itself, so we only seed sensible standalone fallback values here.
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
    .onConflictDoNothing()
    .run();
}
