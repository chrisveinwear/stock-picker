import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { getQuotes } from "@/lib/yahoo-finance";
import { getLatestReport } from "@/lib/report-store";

export const dynamic = "force-dynamic";

export type ResearchAlert = {
  ticker: string;
  companyName: string | null;
  verdict: string | null;
  reportDate: string;
  buyBelow: number;
  sellAbove: number;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  currentPrice: number | null;
  changePercent: number | null;
  zone: "buy" | "hold" | "sell" | "unknown";
  priceLenses: { name: string; buyBelow: number; fairValue?: number; sellAbove: number }[] | null;
  consensusBuyBelow: number;
  consensusSellAbove: number;
  isCommodity: boolean;
  currency: string;
};

export async function GET() {
  try {
    const db = getDb();
    const rows = db
      .select()
      .from(researchReports)
      .where(isNotNull(researchReports.buyBelow))
      .all();

    if (!rows.length) return NextResponse.json([]);

    // Only fetch live prices for equity tickers (not commodities like OIL, GOLD)
    const equityTickers = rows
      .filter((r) => r.ticker.includes("."))
      .map((r) => r.ticker);

    const quoteMap: Record<string, { lastPrice: number; changePercent: number | null }> = {};
    if (equityTickers.length) {
      const quotes = await getQuotes(equityTickers);
      for (const q of quotes) {
        quoteMap[q.ticker] = { lastPrice: q.lastPrice, changePercent: q.changePercent ?? null };
      }
    }

    const alerts: ResearchAlert[] = rows.map((r) => {
      const report = getLatestReport(r.ticker);
      const fm = report?.frontmatter as Record<string, unknown> | undefined;
      const isCommodity = !!(fm?.commodity);
      const unit = (fm?.unit as string | undefined) ?? "";
      const currency = unit.includes("USD") ? "US$" : "$";

      // For commodities, use the spot price from the frontmatter as a fallback
      const commodityPrice = isCommodity
        ? ((fm?.spotPriceAUD ?? fm?.spotPriceBrent ?? fm?.spotPrice) as number | null | undefined) ?? null
        : null;

      const quote = quoteMap[r.ticker];
      const currentPrice = quote?.lastPrice ?? commodityPrice ?? null;

      const buyBelow = r.buyBelow!;
      const sellAbove = r.sellAbove!;

      const zone =
        currentPrice == null
          ? "unknown"
          : currentPrice <= buyBelow
          ? "buy"
          : currentPrice >= sellAbove
          ? "sell"
          : "hold";

      return {
        ticker: r.ticker,
        companyName: r.companyName,
        verdict: r.verdict,
        reportDate: r.reportDate,
        buyBelow,
        sellAbove,
        intrinsicValueLow: r.intrinsicValueLow ?? null,
        intrinsicValueHigh: r.intrinsicValueHigh ?? null,
        currentPrice,
        changePercent: quote?.changePercent ?? null,
        zone,
        priceLenses: (fm?.priceLenses as ResearchAlert["priceLenses"]) ?? null,
        consensusBuyBelow: buyBelow,
        consensusSellAbove: sellAbove,
        isCommodity,
        currency,
      };
    });

    // Sort: buy zone first, then hold, then sell
    const zoneOrder = { buy: 0, hold: 1, sell: 2, unknown: 3 };
    alerts.sort((a, b) => zoneOrder[a.zone] - zoneOrder[b.zone]);

    return NextResponse.json(alerts);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
