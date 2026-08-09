import { eq, and, asc } from "drizzle-orm";
import type { Db } from "@/db";
import { fundTransactions, portfolioHoldings } from "@/db/schema";

/**
 * Recompute the moving weighted-average cost basis and realized gains for
 * every fund_transactions row belonging to (ticker, account), in
 * chronological order, writing avgCostAudAfter/realizedGainAud back onto
 * each row. Must be re-run any time a transaction is inserted, edited, or
 * deleted there — including backdated inserts — since a change anywhere in
 * the timeline shifts every value computed after it.
 */
export function recomputeFundLedger(db: Db, account: string, ticker: string) {
  const rows = db.select().from(fundTransactions)
    .where(and(eq(fundTransactions.account, account), eq(fundTransactions.ticker, ticker)))
    .orderBy(asc(fundTransactions.date), asc(fundTransactions.id))
    .all();

  let totalUnits = 0;
  let totalCost = 0;

  for (const row of rows) {
    const isBuy = row.units > 0;
    let realizedGainAud: number | null = null;

    if (row.type === "opening_balance") {
      // Seed row: carries forward pre-ledger history as a lump sum rather
      // than a priced transaction — netAud holds the opening cost basis.
      totalUnits += row.units;
      totalCost += row.netAud ?? 0;
    } else if (isBuy) {
      totalCost += row.netAud ?? 0;
      totalUnits += row.units;
    } else {
      const sellUnits = -row.units;
      const avgCostBefore = totalUnits > 0 ? totalCost / totalUnits : 0;
      realizedGainAud = row.unitPrice != null ? (row.unitPrice - avgCostBefore) * sellUnits : null;
      totalCost -= avgCostBefore * sellUnits;
      totalUnits -= sellUnits;
    }
    const avgCostAudAfter = totalUnits > 1e-9 ? totalCost / totalUnits : 0;

    db.update(fundTransactions)
      .set({ avgCostAudAfter, realizedGainAud })
      .where(eq(fundTransactions.id, row.id))
      .run();
  }

  return {
    units: totalUnits,
    avgCostAud: totalUnits > 1e-9 ? totalCost / totalUnits : null,
  };
}

/** Current position for (ticker, account), derived from fund_transactions. */
export function getFundPosition(db: Db, account: string, ticker: string) {
  const rows = db.select().from(fundTransactions)
    .where(and(eq(fundTransactions.account, account), eq(fundTransactions.ticker, ticker)))
    .all();
  const units = rows.reduce((s, r) => s + r.units, 0);
  const last = rows.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).at(-1);
  return {
    units,
    avgCostAud: last?.avgCostAudAfter ?? null,
    lastTransactionDate: last?.date ?? null,
  };
}

/**
 * Recompute the ledger for (ticker, account) and write the resulting
 * units/avg cost onto the matching portfolio_holdings row, so the rest of
 * the app (which reads portfolio_holdings directly) picks up the change
 * without needing to know about fund_transactions.
 */
export function syncPortfolioHoldingFromLedger(db: Db, account: string, ticker: string) {
  const position = recomputeFundLedger(db, account, ticker);
  db.update(portfolioHoldings)
    .set({ shares: position.units, avgCost: position.avgCostAud ?? 0, updatedAt: new Date().toISOString() })
    .where(and(eq(portfolioHoldings.ticker, ticker), eq(portfolioHoldings.account, account)))
    .run();
  return position;
}
