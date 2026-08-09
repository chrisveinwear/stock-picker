/**
 * One-off backfill: import Maxwell's private gold register.
 *
 * Maxwell's portfolio is virtual — he has no Perth Mint account of his own.
 * When he "buys" gold, he's buying it from the author's own pooled Perth
 * Mint balance, so every Maxwell buy must be mirrored as an identical
 * (date, quantity, price) sell out of the personal register, and vice versa
 * for future sells. That's the standing rule this script encodes; the same
 * rule is applied live going forward by
 * POST /api/metals/transactions/maxwell-mirror.
 *
 * Source: "Maxwell Gold and Savings Register - Gold.csv" — Maxwell's own
 * running ledger (Amount Paid = Qty x Price, no separate fee line).
 *
 * This also REPLACES the 6 standalone metal_holdings rows previously
 * hand-entered for account="maxwell" with a single ledger-derived row,
 * consistent with how the personal account now works.
 *
 * Run from the web/ directory:
 *   npx tsx scripts/import-maxwell-gold-transactions.ts            # apply
 *   npx tsx scripts/import-maxwell-gold-transactions.ts --dry-run  # print only
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { metalTransactions } from "@/db/schema";
import { recomputeMetalLedger } from "@/lib/metals";

const dryRun = process.argv.includes("--dry-run");

const rows = [
  { date: "2021-04-01", ounces: 0.10000, price: 2050.00, total: 205.00 },
  { date: "2022-02-06", ounces: 0.18789, price: 2586.57, total: 485.99 },
  { date: "2022-12-18", ounces: 0.12295, price: 2716.39, total: 333.98 },
  { date: "2023-12-25", ounces: 0.12037, price: 3032.35, total: 365.00 },
  { date: "2023-12-25", ounces: 0.06596, price: 3032.35, total: 200.00 },
  { date: "2025-02-28", ounces: 0.09157, price: 4641.42, total: 425.00 },
  { date: "2026-02-01", ounces: 0.05019, price: 7272.53, total: 365.00 },
];

console.log(`Parsed ${rows.length} Maxwell buy transactions.`);
const netOunces = rows.reduce((s, r) => s + r.ounces, 0);
console.log(`Net ounces: ${netOunces.toFixed(5)} toz (expected 0.73893 toz per the CSV's own running balance)`);
if (Math.abs(netOunces - 0.73893) > 0.001) {
  console.error("Sanity check failed against the CSV's own running balance. Aborting.");
  process.exit(1);
}

if (dryRun) {
  console.log("--dry-run: not writing to the database.");
  process.exit(0);
}

const db = getDb();

const existingMaxwell = db.select().from(metalTransactions)
  .where(and(eq(metalTransactions.account, "maxwell"), eq(metalTransactions.metal, "gold")))
  .all();
if (existingMaxwell.length > 0) {
  console.error(`Found ${existingMaxwell.length} existing maxwell/gold rows in metal_transactions — refusing to duplicate. Delete them first to re-import.`);
  process.exit(1);
}

for (const r of rows) {
  db.insert(metalTransactions).values({
    metal: "gold",
    type: "buy",
    date: r.date,
    ounces: r.ounces,
    pricePerOzAud: r.price,
    feeAud: 0,
    totalAud: -r.total,
    account: "maxwell",
    source: "Maxwell Gold and Savings Register",
    notes: "Bought from the personal Perth Mint holding (virtual sub-portfolio, no separate custodial account)",
  }).run();

  // Mirrored personal sell — identical date, quantity, price (standing rule)
  db.insert(metalTransactions).values({
    metal: "gold",
    type: "sell",
    date: r.date,
    ounces: -r.ounces,
    pricePerOzAud: r.price,
    feeAud: 0,
    totalAud: r.total,
    account: "personal",
    source: "Internal transfer to Maxwell",
    notes: "Mirror of Maxwell's buy on the same date — an internal allocation out of the shared Perth Mint balance, not a market sale",
  }).run();
}
console.log(`Inserted ${rows.length} Maxwell buys + ${rows.length} mirrored personal sells.`);

// Current position is always derived from the ledger — no separate holdings
// table to reconcile (the metal_holdings table itself was later removed).
const maxwellResult = recomputeMetalLedger(db, "maxwell", "gold");
const personalResult = recomputeMetalLedger(db, "personal", "gold");
console.log(`Maxwell: ${maxwellResult.ounces} toz @ $${maxwellResult.avgCostAud}/oz`);
console.log(`Personal: ${personalResult.ounces} toz @ $${personalResult.avgCostAud}/oz (expected ${(5.132 - netOunces).toFixed(3)} toz — physical 5.132 toz minus Maxwell's share)`);
