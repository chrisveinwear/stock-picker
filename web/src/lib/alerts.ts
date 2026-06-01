import { getDb } from "@/db";
import { watchlist, alertLog } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { getQuotes } from "./yahoo-finance";

export type Alert = {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  targetBuyPrice: number;
  intrinsicValue: number;
  marginOfSafety: number;
};

export async function checkAlerts(): Promise<Alert[]> {
  const db = getDb();
  const items = db.select().from(watchlist)
    .where(and(eq(watchlist.alertEnabled, true)))
    .all();

  if (!items.length) return [];

  const tickers = items.map((w) => w.ticker);
  const quotes = await getQuotes(tickers);
  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  const alerts: Alert[] = [];

  for (const item of items) {
    const quote = quoteMap[item.ticker];
    if (!quote || !item.intrinsicValue || !item.targetBuyPrice) continue;

    const currentPrice = quote.lastPrice;
    const mos = (item.intrinsicValue - currentPrice) / item.intrinsicValue;

    if (currentPrice <= item.targetBuyPrice) {
      alerts.push({
        ticker: item.ticker,
        companyName: item.companyName,
        currentPrice,
        targetBuyPrice: item.targetBuyPrice,
        intrinsicValue: item.intrinsicValue,
        marginOfSafety: mos,
      });

      // Log it (avoid duplicate logs within 24h)
      db.insert(alertLog).values({
        ticker: item.ticker,
        alertType: "buy_zone",
        triggerPrice: currentPrice,
        targetPrice: item.targetBuyPrice,
        marginOfSafety: mos,
      }).run();
    }
  }

  return alerts;
}
