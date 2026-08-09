import { eq, and, asc } from "drizzle-orm";
import type { Db } from "@/db";
import { metalTransactions } from "@/db/schema";

/**
 * Recompute the moving weighted-average cost basis and realized gains for
 * every metal_transactions row belonging to (account, metal), in
 * chronological order, writing avgCostAudAfter/realizedGainAud back onto
 * each row. Must be re-run for an account+metal any time a transaction is
 * inserted, edited, or deleted there — including backdated inserts — since a
 * change anywhere in the timeline shifts every value computed after it.
 *
 * Returns the resulting net position (there is no separate holdings table —
 * current position is always derived from the ledger, see getMetalPositions).
 */
export function recomputeMetalLedger(db: Db, account: string, metal: string) {
  const rows = db.select().from(metalTransactions)
    .where(and(eq(metalTransactions.account, account), eq(metalTransactions.metal, metal)))
    .orderBy(asc(metalTransactions.date), asc(metalTransactions.id))
    .all();

  let totalOunces = 0;
  let totalCost = 0;

  for (const row of rows) {
    const isBuy = row.ounces > 0;
    let realizedGainAud: number | null = null;

    if (isBuy) {
      totalCost += row.ounces * (row.pricePerOzAud ?? 0) + (row.feeAud ?? 0);
      totalOunces += row.ounces;
    } else {
      const sellOunces = -row.ounces;
      const avgCostBefore = totalOunces > 0 ? totalCost / totalOunces : 0;
      realizedGainAud = ((row.pricePerOzAud ?? 0) - avgCostBefore) * sellOunces - (row.feeAud ?? 0);
      totalCost -= avgCostBefore * sellOunces;
      totalOunces -= sellOunces;
    }
    const avgCostAudAfter = totalOunces > 1e-9 ? totalCost / totalOunces : 0;

    db.update(metalTransactions)
      .set({
        avgCostAudAfter: Number(avgCostAudAfter.toFixed(2)),
        realizedGainAud: realizedGainAud != null ? Number(realizedGainAud.toFixed(2)) : null,
      })
      .where(eq(metalTransactions.id, row.id))
      .run();
  }

  return {
    ounces: Number(totalOunces.toFixed(5)),
    avgCostAud: totalOunces > 1e-9 ? Number((totalCost / totalOunces).toFixed(2)) : null,
  };
}

export type MetalPosition = {
  id: string; // `${account}:${metal}` — synthetic, no backing table row
  metal: string;
  account: string;
  label: string;
  location: string;
  storageType: string;
  ounces: number;
  avgCostAud: number | null;
  purchaseDate: string | null; // date of the earliest transaction
  updatedAt: string | null; // date of the most recent transaction
};

const DEFAULT_LABELS: Record<string, string> = {
  gold: "Perth Mint — Unallocated Gold",
  silver: "Perth Mint — Unallocated Silver",
  platinum: "Perth Mint — Unallocated Platinum",
  palladium: "Perth Mint — Unallocated Palladium",
};

/**
 * Current holdings, derived entirely from metal_transactions — one row per
 * (account, metal) with a nonzero net position. This replaces the old
 * metal_holdings snapshot table; there's nothing to keep in sync anymore
 * since it's computed fresh from the ledger on every read.
 */
export function getMetalPositions(db: Db): MetalPosition[] {
  const rows = db.select().from(metalTransactions)
    .orderBy(asc(metalTransactions.date), asc(metalTransactions.id))
    .all();

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const acct = row.account ?? "personal";
    const key = `${acct}:${row.metal}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  const positions: MetalPosition[] = [];
  for (const [key, txs] of groups) {
    const [account, metal] = key.split(":");
    const ounces = Number(txs.reduce((s, t) => s + t.ounces, 0).toFixed(5));
    if (Math.abs(ounces) < 1e-6) continue; // fully disposed — nothing to show
    const last = txs[txs.length - 1];
    const baseLabel = DEFAULT_LABELS[metal] ?? metal;
    positions.push({
      id: key,
      metal,
      account,
      label: account === "maxwell" ? `${baseLabel} (virtual sub-portfolio)` : baseLabel,
      location: "Perth Mint",
      storageType: "unallocated",
      ounces,
      avgCostAud: last.avgCostAudAfter,
      purchaseDate: txs[0].date,
      updatedAt: last.date,
    });
  }
  return positions;
}
