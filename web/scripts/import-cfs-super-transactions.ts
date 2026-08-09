/**
 * Backfill / append CFS FirstChoice Wholesale Personal Super (0110 4038 9625)
 * transactions for FSF0581AU (CFS Index Australian Share) into
 * fund_transactions, then sync the derived position onto the matching
 * portfolio_holdings row.
 *
 * Idempotent by design: each row is de-duped on (account, ticker, date,
 * type, units) before insert, so re-running this script after appending new
 * rows to `rows` below (extracted from a later CFS "Transaction details"
 * statement export) only inserts genuinely new transactions — no need to
 * manually recompute a running total or tell it the current balance.
 *
 * The first row is a synthetic "opening_balance" seed representing all
 * pre-2025-07-14 history. Its units (56,598.8381) were back-solved so that
 * replaying every transaction below lands exactly on the confirmed live
 * total from the CFS website as of 2026-08-09 (59,670.8242 units); its
 * avgCostAudAfter carries forward the last known avg cost estimate
 * (5.58488868013585/unit, from a prior Sharesight sync) as the best
 * available approximation of the pre-ledger cost basis — see conversation
 * history for the full reconciliation. Do not delete/edit this row without
 * redoing that reconciliation.
 *
 * Run from the web/ directory:
 *   npx tsx scripts/import-cfs-super-transactions.ts            # apply
 *   npx tsx scripts/import-cfs-super-transactions.ts --dry-run  # print only
 */
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { fundTransactions } from "@/db/schema";
import { syncPortfolioHoldingFromLedger } from "@/lib/funds";

const dryRun = process.argv.includes("--dry-run");

const TICKER = "FSF0581AU";
const ACCOUNT = "super";
const SOURCE = "Colonial First State - FirstChoice Wholesale Personal Super (0110 4038 9625)";

type Row = {
  date: string;
  type: "opening_balance" | "contribution" | "fee_rebate" | "rollover_withdrawal" | "tax";
  units: number; // signed: + bought, - sold
  unitPrice: number | null;
  grossAud: number | null;
  taxAud: number | null;
  netAud: number | null; // unsigned dollar amount that bought/sold the units
  notes: string | null;
};

const rows: Row[] = [
  // Synthetic seed — see comment above. avgCostAudAfter set directly below
  // (bypassing the normal buy/sell math) rather than derived from netAud.
  { date: "2025-07-13", type: "opening_balance", units: 56598.8381, unitPrice: null, grossAud: null, taxAud: null, netAud: 56598.8381 * 5.58488868013585, notes: "Opening balance carried forward from pre-statement history (back-solved to reconcile to confirmed 2026-08-09 total)" },

  { date: "2025-07-14", type: "contribution", units: 205.3808, unitPrice: 5.6349, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-07-28", type: "contribution", units: 202.6405, unitPrice: 5.7111, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-08-06", type: "rollover_withdrawal", units: -798.8690, unitPrice: 5.7914, grossAud: 4626.57, taxAud: 0, netAud: 4626.57, notes: "Rollover withdrawal" },
  { date: "2025-08-11", type: "contribution", units: 199.5723, unitPrice: 5.7989, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-08-25", type: "contribution", units: 196.5156, unitPrice: 5.8891, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-09-08", type: "contribution", units: 197.8189, unitPrice: 5.8503, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-09-08", type: "fee_rebate", units: 8.0355, unitPrice: 5.8503, grossAud: 47.01, taxAud: 0, netAud: 47.01, notes: "Management Fee Rebate" },
  { date: "2025-09-22", type: "contribution", units: 198.2425, unitPrice: 5.8378, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-10-07", type: "contribution", units: 195.2491, unitPrice: 5.9273, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-10-21", type: "contribution", units: 192.0384, unitPrice: 6.0264, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-11-03", type: "contribution", units: 195.8306, unitPrice: 5.9097, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-11-11", type: "contribution", units: 196.9772, unitPrice: 5.8753, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-12-01", type: "contribution", units: 201.5921, unitPrice: 5.7408, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-12-15", type: "contribution", units: 200.1695, unitPrice: 5.7816, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2025-12-31", type: "contribution", units: 197.8595, unitPrice: 5.8491, grossAud: 1361.53, taxAud: 204.23, netAud: 1157.30, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-01-13", type: "contribution", units: 213.6726, unitPrice: 5.9111, grossAud: 1485.93, taxAud: 222.89, netAud: 1263.04, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-01-27", type: "contribution", units: 201.6036, unitPrice: 5.9802, grossAud: 1418.39, taxAud: 212.76, netAud: 1205.63, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-02-09", type: "contribution", units: 203.3789, unitPrice: 5.9280, grossAud: 1418.39, taxAud: 212.76, netAud: 1205.63, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-02-23", type: "contribution", units: 199.9536, unitPrice: 6.0296, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-03-09", type: "contribution", units: 207.4576, unitPrice: 5.8115, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-03-09", type: "fee_rebate", units: 9.0252, unitPrice: 5.8115, grossAud: 52.45, taxAud: 0, netAud: 52.45, notes: "Management Fee Rebate" },
  { date: "2026-03-25", type: "contribution", units: 208.5955, unitPrice: 5.7798, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-04-13", type: "contribution", units: 200.4073, unitPrice: 6.0159, grossAud: 1418.39, taxAud: 212.76, netAud: 1205.63, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-04-20", type: "contribution", units: 199.7101, unitPrice: 6.0369, grossAud: 1418.39, taxAud: 212.76, netAud: 1205.63, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-05-01", type: "contribution", units: 204.1727, unitPrice: 5.9050, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-05-15", type: "contribution", units: 205.5180, unitPrice: 5.8663, grossAud: 1418.39, taxAud: 212.76, netAud: 1205.63, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-06-01", type: "tax", units: -862.4205, unitPrice: 5.9293, grossAud: 5113.55, taxAud: 0, netAud: 5113.55, notes: "Division 293 due and payable" },
  { date: "2026-06-01", type: "contribution", units: 203.1338, unitPrice: 5.9352, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-06-12", type: "contribution", units: 201.7369, unitPrice: 5.9763, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-06-29", type: "contribution", units: 201.2351, unitPrice: 5.9912, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-07-10", type: "contribution", units: 201.5952, unitPrice: 5.9805, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-07-27", type: "contribution", units: 200.0265, unitPrice: 6.0274, grossAud: 1418.40, taxAud: 212.76, netAud: 1205.64, notes: "Super Guarantee from Fable Food Pty Ltd" },
  { date: "2026-08-06", type: "rollover_withdrawal", units: -702.6225, unitPrice: 6.2497, grossAud: 4391.18, taxAud: 0, netAud: 4391.18, notes: "Rollover withdrawal" },
  { date: "2026-08-06", type: "rollover_withdrawal", units: -213.2470, unitPrice: 6.2497, grossAud: 1332.73, taxAud: 0, netAud: 1332.73, notes: "Rollover withdrawal" },
];

const db = getDb();

const existing = db.select().from(fundTransactions)
  .where(and(eq(fundTransactions.account, ACCOUNT), eq(fundTransactions.ticker, TICKER)))
  .all();
const existingKeys = new Set(existing.map((r) => `${r.date}|${r.type}|${r.units}`));

const toInsert = rows.filter((r) => !existingKeys.has(`${r.date}|${r.type}|${r.units}`));

console.log(`${existing.length} existing rows, ${rows.length} candidate rows, ${toInsert.length} new.`);

if (toInsert.length === 0) {
  console.log("Nothing new to insert.");
  process.exit(0);
}

if (dryRun) {
  console.log("--dry-run: would insert:", toInsert.map((r) => `${r.date} ${r.type} ${r.units}`));
  process.exit(0);
}

for (const row of toInsert) {
  db.insert(fundTransactions).values({
    ticker: TICKER,
    account: ACCOUNT,
    type: row.type,
    date: row.date,
    units: row.units,
    unitPrice: row.unitPrice,
    grossAud: row.grossAud,
    taxAud: row.taxAud,
    netAud: row.netAud,
    source: SOURCE,
    notes: row.notes,
  }).run();
}
console.log(`Inserted ${toInsert.length} rows into fund_transactions.`);

const result = syncPortfolioHoldingFromLedger(db, ACCOUNT, TICKER);
console.log(`${TICKER} (${ACCOUNT}) position: ${result.units.toFixed(4)} units @ $${result.avgCostAud?.toFixed(6)}/unit.`);
