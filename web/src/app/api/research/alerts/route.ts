import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { researchReports, watchlist } from "@/db/schema";
import { isNotNull } from "drizzle-orm";
import { getQuotes } from "@/lib/yahoo-finance";
import { getLatestReport } from "@/lib/report-store";

export const dynamic = "force-dynamic";

export type ResearchAlert = {
  watchlistId: number;
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

    // Only surface reports for tickers currently on the watch list. Removing a
    // stock from the watch list hides its card here (the report itself is kept).
    const watchIds: Record<string, number> = {};
    for (const w of db.select({ id: watchlist.id, ticker: watchlist.ticker }).from(watchlist).all()) {
      watchIds[w.ticker] = w.id;
    }
    const watchedRows = rows.filter((r) => r.ticker in watchIds);
    if (!watchedRows.length) return NextResponse.json([]);

    // Only fetch live prices for equity tickers (not commodities like OIL, GOLD)
    const equityTickers = watchedRows
      .filter((r) => r.ticker.includes("."))
      .map((r) => r.ticker);

    const quoteMap: Record<string, { lastPrice: number; changePercent: number | null }> = {};
    if (equityTickers.length) {
      const quotes = await getQuotes(equityTickers);
      for (const q of quotes) {
        quoteMap[q.ticker] = { lastPrice: q.lastPrice, changePercent: q.changePercent ?? null };
      }
    }

    const alerts: ResearchAlert[] = watchedRows.map((r) => {
      const report = getLatestReport(r.ticker);
      const fm = report?.frontmatter as Record<string, unknown> | undefined;
      const isCommodity = !!(fm?.commodity);
      const unit = (fm?.unit as string | undefined) ?? "";

      // Resolve the price and its currency together, so the displayed symbol
      // always matches the value. ASX equities are AUD; for commodities prefer
      // an explicit AUD spot price (e.g. gold), otherwise fall back to the
      // native-unit spot (e.g. Brent in USD).
      const quote = quoteMap[r.ticker];
      const spotAud = fm?.spotPriceAUD as number | null | undefined;
      const spotNative = (fm?.spotPriceBrent ?? fm?.spotPrice) as number | null | undefined;

      let currentPrice: number | null;
      let currency: string;
      if (quote) {
        currentPrice = quote.lastPrice;
        currency = "AU$"; // ASX equity, AUD
      } else if (isCommodity && spotAud != null) {
        currentPrice = spotAud;
        currency = "AU$"; // AUD spot
      } else if (isCommodity) {
        currentPrice = spotNative ?? null;
        currency = unit.includes("USD") ? "US$" : "AU$";
      } else {
        currentPrice = null;
        currency = unit.includes("USD") ? "US$" : "AU$";
      }

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
        watchlistId: watchIds[r.ticker],
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
