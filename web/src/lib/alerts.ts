import { getDb } from "@/db";
import { watchlist, alertLog, researchReports } from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { getQuotes } from "./yahoo-finance";

export type Alert = {
  ticker: string;
  companyName: string | null;
  currentPrice: number;
  targetPrice: number;
  alertType: "buy_zone" | "sell_zone";
  marginOfSafety: number | null;
  source: "manual" | "research";
};

export type AlertLogEntry = {
  id: number;
  ticker: string;
  alertType: string | null;
  triggerPrice: number | null;
  targetPrice: number | null;
  marginOfSafety: number | null;
  triggeredAt: string | null;
  dismissed: boolean;
};

function alreadyLoggedRecently(db: ReturnType<typeof getDb>, ticker: string, alertType: string): boolean {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const existing = db
    .select({ id: alertLog.id })
    .from(alertLog)
    .where(
      and(
        eq(alertLog.ticker, ticker),
        eq(alertLog.alertType, alertType),
        gte(alertLog.triggeredAt, cutoff)
      )
    )
    .get();
  return !!existing;
}

export async function checkAlerts(): Promise<Alert[]> {
  const db = getDb();

  const items = db.select().from(watchlist).where(eq(watchlist.alertEnabled, true)).all();
  if (!items.length) return [];

  // Latest report per ticker: order by date desc, keep the first (most recent) seen.
  const reports = db.select().from(researchReports).orderBy(desc(researchReports.reportDate)).all();
  const reportMap: Record<string, (typeof reports)[number]> = {};
  for (const r of reports) {
    if (!(r.ticker in reportMap)) reportMap[r.ticker] = r;
  }

  const tickers = items.map((w) => w.ticker);
  const quotes = await getQuotes(tickers);
  const quoteMap = Object.fromEntries(quotes.map((q) => [q.ticker, q]));

  const triggered: Alert[] = [];

  const recordAlert = (alert: Alert) => {
    triggered.push(alert);
    if (!alreadyLoggedRecently(db, alert.ticker, alert.alertType)) {
      db.insert(alertLog).values({
        ticker: alert.ticker,
        alertType: alert.alertType,
        triggerPrice: alert.currentPrice,
        targetPrice: alert.targetPrice,
        marginOfSafety: alert.marginOfSafety,
      }).run();
    }
  };

  for (const item of items) {
    const quote = quoteMap[item.ticker];
    if (!quote) continue;
    const currentPrice = quote.lastPrice;

    const report = reportMap[item.ticker];

    // Buy threshold: prefer the AI consensus buy price; fall back to a manual target.
    // Evaluated independently of the sell threshold.
    const buyBelow = report?.buyBelow ?? item.targetBuyPrice;
    if (buyBelow != null && currentPrice <= buyBelow) {
      const fromResearch = report?.buyBelow != null;
      const ivBase = fromResearch ? report?.intrinsicValueHigh : item.intrinsicValue;
      const mos = ivBase ? (ivBase - currentPrice) / ivBase : null;
      recordAlert({
        ticker: item.ticker,
        companyName: item.companyName,
        currentPrice,
        targetPrice: buyBelow,
        alertType: "buy_zone",
        marginOfSafety: mos,
        source: fromResearch ? "research" : "manual",
      });
    }

    // Sell threshold: AI consensus only (no manual sell target exists).
    if (report?.sellAbove != null && currentPrice >= report.sellAbove) {
      recordAlert({
        ticker: item.ticker,
        companyName: item.companyName,
        currentPrice,
        targetPrice: report.sellAbove,
        alertType: "sell_zone",
        marginOfSafety: null,
        source: "research",
      });
    }
  }

  return triggered;
}

export function getAlertLog(): AlertLogEntry[] {
  const db = getDb();
  return db
    .select()
    .from(alertLog)
    .orderBy(desc(alertLog.triggeredAt))
    .all() as AlertLogEntry[];
}

export function dismissAlert(id: number): void {
  const db = getDb();
  db.update(alertLog).set({ dismissed: true }).where(eq(alertLog.id, id)).run();
}
