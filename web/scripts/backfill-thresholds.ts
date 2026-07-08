/**
 * One-off backfill: re-derive research_reports.buy_below / sell_above with the
 * shared threshold policy (lib/report-thresholds.ts).
 *
 * Reports generated 2026-07-02 → 2026-07-08 stored raw dcf-v2 thresholds even
 * when the model diverged wildly from the report's own IV range (APA: "sell
 * above $2.57" against an $8.50–10.50 IV), producing false buy/sell Action
 * Alerts. This re-runs the decision per row from the report frontmatter
 * (model* + consensus* fields) and the valuation sidecar (lowConfidence flag),
 * then applies the IV coherence clamp. Commodity rows are left untouched —
 * their incentive zones never had the bug, and the superseded GOLD/SILVER
 * artifacts carry frontmatter too malformed to re-derive from.
 *
 * Run from the web/ directory:
 *   npx tsx scripts/backfill-thresholds.ts           # apply
 *   npx tsx scripts/backfill-thresholds.ts --dry-run # print only
 */
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { resolveReportThresholds, type ThresholdModel } from "@/lib/report-thresholds";

const dryRun = process.argv.includes("--dry-run");

const num = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

function readSidecarLowConfidence(reportPath: string): boolean | null {
  const sidecar = reportPath.replace(/\.md$/, ".valuation.json");
  if (!fs.existsSync(sidecar)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(sidecar, "utf-8"));
    const flag = parsed?.model?.sensitivity?.lowConfidence;
    return typeof flag === "boolean" ? flag : null;
  } catch {
    return null;
  }
}

const db = getDb();
const rows = db.select().from(researchReports).all();
let changed = 0;
let skipped = 0;

for (const row of rows) {
  if (!row.filePath) {
    console.log(`SKIP  ${row.ticker} ${row.reportDate}: no file path on row`);
    skipped++;
    continue;
  }
  const reportPath = path.isAbsolute(row.filePath) ? row.filePath : path.resolve(row.filePath);
  if (!fs.existsSync(reportPath)) {
    console.log(`SKIP  ${row.ticker} ${row.reportDate}: report file missing (${row.filePath})`);
    skipped++;
    continue;
  }

  let data: Record<string, unknown>;
  try {
    data = matter(fs.readFileSync(reportPath, "utf-8")).data;
  } catch {
    console.log(`SKIP  ${row.ticker} ${row.reportDate}: unparseable frontmatter`);
    skipped++;
    continue;
  }

  const isCommodity = !!data.commodity;
  if (isCommodity) continue;
  const ivLow = row.intrinsicValueLow ?? num(data.intrinsicValueLow);
  const ivHigh = row.intrinsicValueHigh ?? num(data.intrinsicValueHigh);

  // Rebuild the model input from the system-stamped frontmatter fields. The
  // lowConfidence flag only lives in the sidecar; when neither model numbers
  // nor a sidecar exist, there is no model and the consensus path is used.
  const fairValue = num(data.modelFairValue);
  const modelBuy = num(data.modelBuyBelow);
  const modelSell = num(data.modelSellAbove);
  const model: ThresholdModel | null =
    fairValue != null && modelBuy != null && modelSell != null
      ? {
          kind: "equity",
          fairValue,
          buyBelow: modelBuy,
          sellAbove: modelSell,
          lowConfidence: readSidecarLowConfidence(reportPath) ?? false,
        }
      : null;

  const resolved = resolveReportThresholds({
    model,
    consensusBuyBelow: num(data.consensusBuyBelow),
    consensusSellAbove: num(data.consensusSellAbove),
    ivLow,
    ivHigh,
    isCommodity: false,
  });

  // Nothing to write with: keep whatever the row has rather than nulling it.
  if (resolved.buyBelow == null && resolved.sellAbove == null) {
    console.log(`SKIP  ${row.ticker} ${row.reportDate}: no model or consensus thresholds in frontmatter`);
    skipped++;
    continue;
  }

  const buyBelow = resolved.buyBelow ?? row.buyBelow;
  const sellAbove = resolved.sellAbove ?? row.sellAbove;
  if (buyBelow === row.buyBelow && sellAbove === row.sellAbove) continue;

  console.log(
    `FIX   ${row.ticker} ${row.reportDate} [${resolved.source}${resolved.modelRejectedReason ? `: ${resolved.modelRejectedReason}` : ""}]` +
      `\n      buyBelow ${row.buyBelow} -> ${buyBelow} · sellAbove ${row.sellAbove} -> ${sellAbove} (IV ${ivLow}–${ivHigh})`
  );
  changed++;

  if (!dryRun) {
    db.update(researchReports)
      .set({ buyBelow, sellAbove })
      .where(eq(researchReports.id, row.id))
      .run();
  }
}

console.log(`\n${dryRun ? "[dry-run] " : ""}${changed} row(s) ${dryRun ? "would change" : "updated"}, ${skipped} skipped, ${rows.length} total.`);
