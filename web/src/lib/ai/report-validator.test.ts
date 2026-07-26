import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { validateReportIntegrity } from "./report-validator";
import type { TechnicalReading } from "@/lib/technicals";

const reportsDir = join(__dirname, "../../../reports");

function load(path: string) {
  return readFileSync(join(reportsDir, path), "utf8");
}

describe("validateReportIntegrity — estimated-technicals false positives", () => {
  it("does not flag RDX's 'roughly midway between support/resistance' clause", () => {
    const content = load("RDX/2026-07-26.md");
    const technicals: TechnicalReading = {
      rsi14: 48.0,
      sma50: 3.56,
      sma200: 3.17,
    } as TechnicalReading;
    const violations = validateReportIntegrity(content, { type: "stock", technicals, price: 3.67 });
    expect(violations.map((v) => v.rule)).not.toContain("estimated-technicals");
  });

  it("does not flag ORA's 'roughly midway' clause", () => {
    const content = load("ORA/2026-07-26.md");
    const technicals: TechnicalReading = {
      rsi14: 62.3,
      sma50: 1.36,
      sma200: 1.83,
    } as TechnicalReading;
    const violations = validateReportIntegrity(content, { type: "stock", technicals, price: 1.46 });
    expect(violations.map((v) => v.rule)).not.toContain("estimated-technicals");
  });

  it("still flags a genuine estimated-indicator sentence", () => {
    const content = `### 15. Citadel Technical Analysis\n\nRSI(14) is roughly estimated at 70 based on recent momentum.\n\n### 16. Renaissance Quant Patterns`;
    const technicals: TechnicalReading = { rsi14: 48.0 } as TechnicalReading;
    const violations = validateReportIntegrity(content, { type: "stock", technicals, price: 1 });
    expect(violations.map((v) => v.rule)).toContain("estimated-technicals");
  });
});

describe("validateReportIntegrity — price-anchor-mismatch false positives", () => {
  it("does not flag GNG's 'gap to current price: AUD 3.85 vs AUD 5.16' clause", () => {
    const content = load("GNG/2026-07-21.md");
    const violations = validateReportIntegrity(content, { type: "stock", price: 5.16 });
    expect(violations.map((v) => v.rule)).not.toContain("price-anchor-mismatch");
  });

  it("still flags a genuine price mismatch", () => {
    const content = `**VERDICT — WATCH.** Current price AUD 10.00 sits against fair value.\n\n## PART A`;
    const violations = validateReportIntegrity(content, { type: "stock", price: 15.0 });
    expect(violations.map((v) => v.rule)).toContain("price-anchor-mismatch");
  });
});
