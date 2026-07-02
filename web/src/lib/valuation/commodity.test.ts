import { describe, it, expect } from "vitest";
import {
  COMMODITY_DEFAULTS,
  costCurveAgeMonths,
  normaliseCommodity,
  COST_CURVE_STALE_MONTHS,
} from "./commodity";

describe("costCurveAgeMonths", () => {
  const now = new Date("2026-07-02");
  it("computes whole-month age from a YYYY-MM stamp", () => {
    expect(costCurveAgeMonths("2026-07", now)).toBe(0);
    expect(costCurveAgeMonths("2026-01", now)).toBe(6);
    expect(costCurveAgeMonths("2025-07", now)).toBe(12);
    expect(costCurveAgeMonths("2024-06-15", now)).toBe(25);
  });
  it("treats an unparseable stamp as infinitely stale", () => {
    expect(costCurveAgeMonths("", now)).toBe(Infinity);
    expect(costCurveAgeMonths("unknown", now)).toBe(Infinity);
  });
  it("stale threshold is a year", () => {
    expect(COST_CURVE_STALE_MONTHS).toBe(12);
  });
});

describe("COMMODITY_DEFAULTS integrity", () => {
  const entries = Object.entries(COMMODITY_DEFAULTS);

  it("every entry has a dated vintage and a source", () => {
    for (const [key, d] of entries) {
      expect(/^\d{4}-\d{2}/.test(d.asOf), `${key} asOf "${d.asOf}"`).toBe(true);
      expect(d.source.length, `${key} source`).toBeGreaterThan(3);
    }
  });

  it("cost curve is ordered: AISC50 < AISC90 < incentive price", () => {
    for (const [key, d] of entries) {
      expect(d.aisc50, `${key} aisc50 < aisc90`).toBeLessThan(d.aisc90);
      expect(d.aisc90, `${key} aisc90 < incentive`).toBeLessThan(d.incentivePrice);
    }
  });

  it("bands are sane fractions", () => {
    for (const [key, d] of entries) {
      expect(d.mos, `${key} mos`).toBeGreaterThan(0);
      expect(d.mos, `${key} mos`).toBeLessThan(0.5);
      expect(d.overvaluedBand, `${key} band`).toBeGreaterThan(0);
      expect(d.overvaluedBand, `${key} band`).toBeLessThanOrEqual(0.5);
    }
  });
});

describe("normaliseCommodity", () => {
  it("maps aliases onto maintained keys", () => {
    expect(normaliseCommodity("XAU")).toBe("GOLD");
    expect(normaliseCommodity("wti")).toBe("OIL");
    expect(normaliseCommodity("Iron Ore")).toBe("IRON_ORE");
  });
});
