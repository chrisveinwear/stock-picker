/**
 * Run the deterministic valuation engine for a ticker and print the full result —
 * a fast audit/smoke check without generating a report.
 *
 *   npx tsx scripts/valuation-check.ts WDS.AX
 *   npx tsx scripts/valuation-check.ts GOLD --commodity
 */
import { runEquityValuation } from "@/lib/valuation";
import { runCommodityValuation } from "@/lib/valuation/commodity";

async function main() {
  const args = process.argv.slice(2);
  const ticker = args.find((a) => !a.startsWith("--"));
  const isCommodity = args.includes("--commodity");
  if (!ticker) {
    console.error("usage: npx tsx scripts/valuation-check.ts <TICKER> [--commodity]");
    process.exit(1);
  }

  const result = isCommodity
    ? await runCommodityValuation(ticker)
    : await runEquityValuation(ticker);

  console.log(JSON.stringify(result, null, 2));

  if (result.kind === "equity") {
    const mos = result.assumptions.marginOfSafety?.value ?? 0.3;
    console.error(
      `\n[summary] ${result.ticker} price ${result.currency} ${result.price.toFixed(2)} · fair value ${result.codeFairValue.toFixed(2)} ` +
        `(range ${result.codeIvLow.toFixed(2)}–${result.codeIvHigh.toFixed(2)}) · ` +
        `buy < ${(result.codeFairValue * (1 - mos)).toFixed(2)} · sell > ${(result.codeFairValue * (1 + mos)).toFixed(2)} · ` +
        `discount ${(result.discountRate * 100).toFixed(1)}% · growth ${(result.stage1Growth * 100).toFixed(1)}% · ` +
        `${result.warnings.length} warning(s)`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
