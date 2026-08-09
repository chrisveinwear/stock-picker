/**
 * One-off backfill: import the full personal Perth Mint / GoldPass gold
 * transaction history (2021-01-27 -> 2026-01-31) from account statements into
 * metal_transactions, then roll the resulting net position up into
 * metal_holdings (account="personal", metal="gold").
 *
 * Source documents:
 *  - GoldPass account statement (01/01/2021-30/06/2024), covers 2021-01-27 to
 *    2023-04-25. On 2023-06-07 the GoldPass balance (23.613 toz) was
 *    transferred into Perth Mint Storage account 77370 - that transfer is an
 *    internal custody move, not a new acquisition, so it is NOT recorded as
 *    its own transaction (the two source ledgers are stitched into one
 *    continuous timeline instead).
 *  - Perth Mint Storage account statements (77370), covering the sells/buy
 *    from 2023-08-13 through 2026-01-31.
 *
 * Cost basis uses the moving weighted-average method: each buy blends into
 * the running avg cost/oz; each sell realises (price - avg cost) x ounces and
 * leaves the remaining avg cost unchanged. Verified against statement-stated
 * balances: GoldPass buys-sells net to 23.613 toz (matches the transfer
 * weight exactly); Storage sells/buy net 23.613 -> 5.132 toz (matches the
 * FY26 closing balance exactly).
 *
 * Run from the web/ directory:
 *   npx tsx scripts/import-gold-transactions.ts            # apply
 *   npx tsx scripts/import-gold-transactions.ts --dry-run  # print only
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { metalTransactions } from "@/db/schema";
import { recomputeMetalLedger } from "@/lib/metals";

const dryRun = process.argv.includes("--dry-run");

type Row = {
  date: string;
  type: "buy" | "sell";
  ounces: number; // unsigned magnitude as shown on the statement
  price: number; // AUD per oz
  fee: number; // AUD, unsigned
  total: number; // AUD, unsigned magnitude
  source: string;
  orderId?: string;
};

const GOLDPASS = "Perth Mint GoldPass";
const STORAGE = "Perth Mint Storage (77370)";

// Chronological ascending. GoldPass rows carry no order code in the source
// statement export; Storage rows use the order IDs on the account statement.
const rows: Row[] = [
  { date: "2021-01-27", type: "buy", ounces: 0.12953, price: 2397.88, fee: 3.11, total: 313.71, source: GOLDPASS },
  { date: "2021-02-11", type: "buy", ounces: 0.12397, price: 2395.75, fee: 2.97, total: 299.97, source: GOLDPASS },
  { date: "2021-02-24", type: "buy", ounces: 0.12985, price: 2287.47, fee: 2.97, total: 300.00, source: GOLDPASS },
  { date: "2021-03-11", type: "buy", ounces: 0.13265, price: 2239.27, fee: 2.97, total: 300.01, source: GOLDPASS },
  { date: "2021-03-24", type: "buy", ounces: 0.13006, price: 2284.87, fee: 2.97, total: 300.14, source: GOLDPASS },
  { date: "2021-04-02", type: "buy", ounces: 20.86353, price: 2278.35, fee: 451.58, total: 47986.00, source: GOLDPASS },
  { date: "2021-04-06", type: "buy", ounces: 0.87316, price: 2282.59, fee: 19.93, total: 2013.00, source: GOLDPASS },
  { date: "2021-04-07", type: "buy", ounces: 0.12987, price: 2286.85, fee: 2.97, total: 299.96, source: GOLDPASS },
  { date: "2021-04-22", type: "buy", ounces: 0.21330, price: 2320.76, fee: 4.95, total: 499.97, source: GOLDPASS },
  { date: "2021-05-19", type: "buy", ounces: 0.20559, price: 2407.94, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2021-06-02", type: "buy", ounces: 0.20154, price: 2456.36, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2021-06-03", type: "buy", ounces: 0.20167, price: 2454.83, fee: 4.95, total: 500.02, source: GOLDPASS },
  { date: "2021-06-16", type: "buy", ounces: 0.20469, price: 2418.56, fee: 4.95, total: 500.01, source: GOLDPASS },
  { date: "2021-07-06", type: "buy", ounces: 0.20792, price: 2380.88, fee: 4.95, total: 499.98, source: GOLDPASS },
  { date: "2021-07-15", type: "buy", ounces: 0.20103, price: 2462.51, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2021-08-03", type: "buy", ounces: 0.20062, price: 2467.53, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2021-08-11", type: "buy", ounces: 0.20838, price: 2375.64, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2021-08-26", type: "buy", ounces: 0.20060, price: 2467.75, fee: 4.95, total: 499.98, source: GOLDPASS },
  { date: "2021-10-10", type: "buy", ounces: 0.61623, price: 2410.06, fee: 14.85, total: 1500.00, source: GOLDPASS },
  { date: "2021-10-20", type: "buy", ounces: 0.20757, price: 2384.89, fee: 4.95, total: 499.98, source: GOLDPASS },
  { date: "2021-11-03", type: "sell", ounces: 12.62157, price: 2399.70, fee: 287.74, total: 30000.24, source: GOLDPASS },
  { date: "2021-12-08", type: "buy", ounces: 0.59123, price: 2511.94, fee: 14.85, total: 1499.98, source: GOLDPASS },
  { date: "2021-12-21", type: "buy", ounces: 0.19596, price: 2526.15, fee: 4.95, total: 499.97, source: GOLDPASS },
  { date: "2021-12-30", type: "buy", ounces: 0.19814, price: 2498.36, fee: 4.95, total: 499.98, source: GOLDPASS },
  { date: "2022-01-16", type: "buy", ounces: 0.19606, price: 2524.94, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2022-02-06", type: "buy", ounces: 0.18789, price: 2560.99, fee: 4.81, total: 485.99, source: GOLDPASS },
  { date: "2022-02-09", type: "buy", ounces: 0.19361, price: 2556.57, fee: 4.95, total: 499.93, source: GOLDPASS },
  { date: "2022-02-24", type: "buy", ounces: 22.67352, price: 2643.00, fee: 569.30, total: 60495.41, source: GOLDPASS },
  { date: "2022-03-10", type: "buy", ounces: 0.18135, price: 2730.46, fee: 4.95, total: 500.12, source: GOLDPASS },
  { date: "2022-03-23", type: "buy", ounces: 0.19130, price: 2587.52, fee: 4.95, total: 499.94, source: GOLDPASS },
  { date: "2022-04-16", type: "buy", ounces: 0.18551, price: 2668.58, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-04-27", type: "buy", ounces: 0.18625, price: 2657.60, fee: 4.95, total: 499.93, source: GOLDPASS },
  { date: "2022-05-04", type: "buy", ounces: 0.18800, price: 2633.28, fee: 4.95, total: 500.01, source: GOLDPASS },
  { date: "2022-05-21", type: "buy", ounces: 0.18842, price: 2627.31, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2022-06-05", type: "buy", ounces: 0.19217, price: 2576.11, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-06-17", type: "buy", ounces: 0.18770, price: 2637.30, fee: 4.95, total: 499.97, source: GOLDPASS },
  { date: "2022-06-24", type: "sell", ounces: 4.59614, price: 2635.99, fee: 115.10, total: 12000.28, source: GOLDPASS },
  { date: "2022-07-19", type: "sell", ounces: 1.63025, price: 2478.18, fee: 40.40, total: 3999.65, source: GOLDPASS },
  { date: "2022-07-20", type: "sell", ounces: 2.04360, price: 2471.71, fee: 50.51, total: 5000.68, source: GOLDPASS },
  { date: "2022-08-14", type: "buy", ounces: 0.39019, price: 2537.47, fee: 9.90, total: 1000.00, source: GOLDPASS },
  { date: "2022-08-28", type: "buy", ounces: 0.19567, price: 2530.03, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-09-11", type: "buy", ounces: 0.19671, price: 2516.63, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-09-22", type: "sell", ounces: 6.19135, price: 2511.20, fee: 147.70, total: 15400.02, source: GOLDPASS },
  { date: "2022-09-27", type: "buy", ounces: 0.19626, price: 2522.40, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-10-12", type: "buy", ounces: 0.18589, price: 2663.22, fee: 4.95, total: 500.02, source: GOLDPASS },
  { date: "2022-12-05", type: "buy", ounces: 0.74568, price: 2655.56, fee: 19.80, total: 2000.00, source: GOLDPASS },
  { date: "2022-12-18", type: "buy", ounces: 0.12295, price: 2689.46, fee: 3.31, total: 333.98, source: GOLDPASS },
  { date: "2022-12-30", type: "buy", ounces: 0.18379, price: 2693.57, fee: 4.95, total: 500.00, source: GOLDPASS },
  { date: "2022-12-30", type: "buy", ounces: 0.06616, price: 2693.48, fee: 1.78, total: 179.98, source: GOLDPASS },
  { date: "2023-01-31", type: "buy", ounces: 0.36257, price: 2730.84, fee: 9.90, total: 1000.02, source: GOLDPASS },
  { date: "2023-02-10", type: "buy", ounces: 0.18436, price: 2685.18, fee: 4.95, total: 499.99, source: GOLDPASS },
  { date: "2023-02-22", type: "sell", ounces: 1.13576, price: 2668.06, fee: 30.30, total: 2999.98, source: GOLDPASS },
  { date: "2023-04-01", type: "sell", ounces: 2.75114, price: 2937.26, fee: 80.81, total: 8000.00, source: GOLDPASS },
  { date: "2023-04-01", type: "buy", ounces: 0.30156, price: 2954.94, fee: 8.91, total: 900.00, source: GOLDPASS },
  { date: "2023-04-25", type: "buy", ounces: 0.33193, price: 2982.79, fee: 9.90, total: 999.98, source: GOLDPASS },
  // GoldPass -> Perth Mint Storage account 77370 custody transfer (2023-06-07,
  // 23.613 toz) intentionally omitted here - not a new transaction.
  { date: "2023-08-13", type: "sell", ounces: 3.780, price: 2937.49, fee: 105.49, total: 10998.22, source: STORAGE, orderId: "276792" },
  { date: "2024-01-02", type: "sell", ounces: 3.331, price: 3032.17, fee: 95.95, total: 10004.21, source: STORAGE, orderId: "295370" },
  { date: "2024-01-28", type: "sell", ounces: 2.475, price: 3060.45, fee: 75.75, total: 7498.86, source: STORAGE, orderId: "297516" },
  { date: "2024-03-14", type: "sell", ounces: 3.084, price: 3274.96, fee: 95.94, total: 10003.42, source: STORAGE, orderId: "304018" },
  { date: "2025-06-17", type: "sell", ounces: 4.890, price: 5160.14, fee: 239.75, total: 24997.34, source: STORAGE, orderId: "388367" },
  { date: "2025-06-18", type: "sell", ounces: 0.971, price: 5196.24, fee: 50.46, total: 4995.09, source: STORAGE, orderId: "388616" },
  { date: "2026-01-31", type: "buy", ounces: 0.050, price: 7115.00, fee: 3.56, total: 359.31, source: STORAGE, orderId: "474254" },
];

// Roll the moving weighted-average cost basis forward and realise gains on sells.
let totalOunces = 0;
let totalCost = 0; // AUD
const prepared = rows.map((r) => {
  const signedOunces = r.type === "buy" ? r.ounces : -r.ounces;
  const signedTotal = r.type === "buy" ? -r.total : r.total;
  let realizedGainAud: number | null = null;

  if (r.type === "buy") {
    totalCost += r.ounces * r.price + r.fee;
    totalOunces += r.ounces;
  } else {
    const avgCostBefore = totalOunces > 0 ? totalCost / totalOunces : 0;
    realizedGainAud = (r.price - avgCostBefore) * r.ounces - r.fee;
    totalCost -= avgCostBefore * r.ounces;
    totalOunces -= r.ounces;
  }
  const avgCostAudAfter = totalOunces > 0 ? totalCost / totalOunces : 0;

  return {
    metal: "gold",
    type: r.type,
    date: r.date,
    ounces: Number(signedOunces.toFixed(5)),
    pricePerOzAud: r.price,
    feeAud: r.fee,
    totalAud: Number(signedTotal.toFixed(2)),
    avgCostAudAfter: Number(avgCostAudAfter.toFixed(2)),
    realizedGainAud: realizedGainAud != null ? Number(realizedGainAud.toFixed(2)) : null,
    account: "personal",
    source: r.source,
    orderId: r.orderId ?? null,
    notes: null as string | null,
  };
});

console.log(`Parsed ${prepared.length} transactions.`);
console.log(`Net ounces: ${totalOunces.toFixed(3)} toz (expected 5.132 toz)`);
console.log(`Final avg cost: $${(totalCost / totalOunces).toFixed(2)}/oz`);

if (Math.abs(totalOunces - 5.132) > 0.001) {
  console.error("Sanity check failed — net ounces does not match the FY26 statement closing balance. Aborting.");
  process.exit(1);
}

if (dryRun) {
  console.log("--dry-run: not writing to the database.");
  process.exit(0);
}

const db = getDb();

const existing = db.select().from(metalTransactions)
  .where(and(eq(metalTransactions.account, "personal"), eq(metalTransactions.metal, "gold")))
  .all();
if (existing.length > 0) {
  console.error(`Found ${existing.length} existing personal/gold rows in metal_transactions — refusing to duplicate. Delete them first if you want to re-import.`);
  process.exit(1);
}

for (const row of prepared) {
  db.insert(metalTransactions).values(row).run();
}
console.log(`Inserted ${prepared.length} rows into metal_transactions.`);

// Current position is always derived from the ledger — no separate holdings
// table to update. recomputeMetalLedger just writes avgCostAudAfter/
// realizedGainAud onto each row and returns the resulting net position.
const result = recomputeMetalLedger(db, "personal", "gold");
console.log(`Personal gold position: ${result.ounces} toz @ $${result.avgCostAud}/oz.`);
