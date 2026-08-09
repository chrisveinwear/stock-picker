import { describe, expect, it } from "vitest";
import { MORNINGSTAR_TEMPLATE_COLUMNS, parseMorningstarCsv } from "./morningstar";

describe("Morningstar import template", () => {
  it("every template column is recognised by the parser", () => {
    // The download template (/api/morningstar/template) is built from
    // MORNINGSTAR_TEMPLATE_COLUMNS — a filled-in copy must round-trip.
    const header = MORNINGSTAR_TEMPLATE_COLUMNS.map((c) => c.header).join(",");
    const example = MORNINGSTAR_TEMPLATE_COLUMNS.map((c) => c.example).join(",");
    const result = parseMorningstarCsv(`${header}\n${example}`, { asOf: "2026-07-11" });

    for (const c of MORNINGSTAR_TEMPLATE_COLUMNS) {
      expect(result.detectedColumns, `column "${c.header}" not detected as "${c.concept}"`).toHaveProperty(c.concept);
    }

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.ticker).toBe("CSL.AX");
    expect(row.economicMoat).toBe("Wide");
    // The template asks for a dollar Fair Value, not a ratio — the pure parser
    // can't derive Price/Fair Value without a live price, so that's left null
    // here; the API route fills it in before saving (see route.ts).
    expect(row.fairValue).toBeCloseTo(24.5, 5);
    expect(row.priceToFairValue).toBeNull();
    expect(row.starRating).toBe(4);
    expect(row.uncertainty).toBe("Medium");
    expect(row.capitalAllocation).toBe("Exemplary");
  });

  it("rows with a ticker but no coverage are skipped", () => {
    const header = MORNINGSTAR_TEMPLATE_COLUMNS.map((c) => c.header).join(",");
    const result = parseMorningstarCsv(`${header}\nWOW,Woolworths,,,,,`, { asOf: "2026-07-11" });
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("a raw Price/Fair Value ratio column (real Morningstar export) is still parsed directly", () => {
    const csv = "Symbol,Holding Name,Economic Moat,Price/Fair Value\nCSL,CSL Limited,Wide,0.85";
    const result = parseMorningstarCsv(csv, { asOf: "2026-07-11" });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].priceToFairValue).toBeCloseTo(0.85, 5);
    expect(result.rows[0].fairValue).toBeNull();
  });

  it("Price/Fair Value and Fair Value columns are detected independently when both present", () => {
    const csv =
      "Symbol,Holding Name,Economic Moat,Price/Fair Value,Fair Value\nCSL,CSL Limited,Wide,0.85,24.50";
    const result = parseMorningstarCsv(csv, { asOf: "2026-07-11" });
    expect(result.detectedColumns.pfv).toBe(3);
    expect(result.detectedColumns.fv).toBe(4);
    expect(result.rows[0].priceToFairValue).toBeCloseTo(0.85, 5);
    expect(result.rows[0].fairValue).toBeCloseTo(24.5, 5);
  });
});
