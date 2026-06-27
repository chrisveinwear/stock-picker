import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { getLatestReport } from "@/lib/report-store";

export const dynamic = "force-dynamic";

// AI consensus data for a portfolio holding, surfaced only when the latest
// research report for that ticker was completed within the past 3 months.
export type PortfolioConsensus = {
  ticker: string;
  reportDate: string;
  verdict: string | null;
  consensusBuyBelow: number;
  consensusSellAbove: number;
  lenses: { name: string; buyBelow: number; fairValue?: number; sellAbove: number }[];
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
};

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(researchReports)
      .where(isNotNull(researchReports.buyBelow))
      .all();

    if (!rows.length) return NextResponse.json({});

    // Keep only the most recent report per ticker.
    const latestByTicker: Record<string, (typeof rows)[number]> = {};
    for (const r of rows) {
      const cur = latestByTicker[r.ticker];
      if (!cur || r.reportDate > cur.reportDate) latestByTicker[r.ticker] = r;
    }

    // "Within the past 3 months" — anything older is dropped.
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);

    const result: Record<string, PortfolioConsensus> = {};
    for (const [ticker, r] of Object.entries(latestByTicker)) {
      if (Number.isNaN(Date.parse(r.reportDate))) continue;
      if (new Date(r.reportDate) < cutoff) continue;

      const buyBelow = r.buyBelow!;
      const sellAbove = r.sellAbove!;

      // Prefer the per-lens prices from the report frontmatter (so the chart
      // can derive a fair-value line). Fall back to a single synthetic lens
      // built from the IV midpoint, or the buy/sell midpoint, so a fair-value
      // marker always renders.
      const fm = getLatestReport(ticker)?.frontmatter;
      let lenses = fm?.priceLenses ?? [];
      if (!lenses.length) {
        const fv =
          r.intrinsicValueLow != null && r.intrinsicValueHigh != null
            ? (r.intrinsicValueLow + r.intrinsicValueHigh) / 2
            : (buyBelow + sellAbove) / 2;
        lenses = [{ name: "Consensus", buyBelow, fairValue: fv, sellAbove }];
      }

      result[ticker] = {
        ticker,
        reportDate: r.reportDate,
        verdict: r.verdict,
        consensusBuyBelow: buyBelow,
        consensusSellAbove: sellAbove,
        lenses,
        intrinsicValueLow: r.intrinsicValueLow ?? null,
        intrinsicValueHigh: r.intrinsicValueHigh ?? null,
      };
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
