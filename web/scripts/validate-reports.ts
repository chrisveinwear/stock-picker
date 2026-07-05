/**
 * Run the integrity validator against existing report files — a fixture check
 * for the validator rules (no technicals/price context available historically,
 * so only the pattern rules fire; anchor checks need a live generation).
 *
 *   npx tsx scripts/validate-reports.ts [TICKER ...]
 */
import fs from "fs";
import path from "path";
import { validateReportIntegrity } from "../src/lib/ai/report-validator";

const reportsDir = path.join(process.cwd(), "reports");
const only = process.argv.slice(2).map((t) => t.toUpperCase());

let files = 0;
let flagged = 0;
for (const ticker of fs.readdirSync(reportsDir).sort()) {
  if (only.length && !only.includes(ticker.toUpperCase())) continue;
  const dir = path.join(reportsDir, ticker);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const content = fs.readFileSync(path.join(dir, file), "utf-8");
    const isCommodity = /^commodity:/m.test(content);
    const violations = validateReportIntegrity(content, {
      type: isCommodity ? "commodity" : "stock",
    });
    files++;
    if (violations.length) {
      flagged++;
      console.log(`\n${ticker}/${file}`);
      for (const v of violations) console.log(`  [${v.severity}] ${v.rule}: ${v.detail.slice(0, 140)}`);
    }
  }
}
console.log(`\n${files} reports checked, ${flagged} with violations`);
