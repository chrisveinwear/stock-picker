import { describe, it, expect } from "vitest";
import {
  costOfEquity,
  equityDcf,
  fadedGrowth,
  sensitivityGrid,
  ownerEarningsMultiple,
  grahamNumber,
  impliedGrowth,
  qualityTier,
  type DcfParams,
} from "./dcf";

const base: DcfParams = {
  baseOwnerEarnings: 100,
  growth: 0.04,
  years: 10,
  terminalGrowth: 0.025,
  discountRate: 0.1,
  exitMultiple: 12,
  shares: 10,
};

describe("costOfEquity", () => {
  it("is CAPM: rf + beta x ERP", () => {
    expect(costOfEquity({ beta: 1, riskFreeRate: 0.043, equityRiskPremium: 0.055 })).toBeCloseTo(0.098, 10);
    expect(costOfEquity({ beta: 0.6, riskFreeRate: 0.043, equityRiskPremium: 0.055 })).toBeCloseTo(0.076, 10);
  });
});

describe("fadedGrowth", () => {
  it("starts at stage-1 growth and ends at terminal growth", () => {
    expect(fadedGrowth(1, 10, 0.10, 0.025)).toBeCloseTo(0.10, 10);
    expect(fadedGrowth(10, 10, 0.10, 0.025)).toBeCloseTo(0.025, 10);
  });
  it("fades monotonically", () => {
    const g = (y: number) => fadedGrowth(y, 10, 0.10, 0.025);
    for (let y = 2; y <= 10; y++) expect(g(y)).toBeLessThan(g(y - 1));
  });
});

describe("equityDcf", () => {
  it("matches a hand-computed flat-perpetuity case", () => {
    // Flat 100/yr for 10 years at 10%, terminal = avg(100/0.1, 100x10) = 1000.
    const r = equityDcf({
      baseOwnerEarnings: 100,
      growth: 0,
      years: 10,
      terminalGrowth: 0,
      discountRate: 0.1,
      exitMultiple: 10,
      shares: 1,
    });
    const annuity = (1 - Math.pow(1.1, -10)) / 0.1; // 6.144567...
    expect(r.pvExplicit).toBeCloseTo(100 * annuity, 6);
    expect(r.tvPerpetuity).toBeCloseTo(1000, 6);
    expect(r.tvExit).toBeCloseTo(1000, 6);
    expect(r.pvTerminal).toBeCloseTo(1000 / Math.pow(1.1, 10), 6);
    expect(r.perShare).toBeCloseTo(100 * annuity + 1000 / Math.pow(1.1, 10), 6);
  });

  it("equity value is the discounted-flow PV — no separate net-debt deduction", () => {
    const r = equityDcf(base);
    expect(r.equityValue).toBeCloseTo(r.pvExplicit + r.pvTerminal, 8);
  });

  it("flags a floored perpetuity spread instead of exploding", () => {
    const r = equityDcf({ ...base, discountRate: 0.03, terminalGrowth: 0.025 });
    expect(r.tvSpreadFloored).toBe(true);
    expect(Number.isFinite(r.perShare)).toBe(true);
    expect(equityDcf(base).tvSpreadFloored).toBe(false);
  });

  it("is monotonic: higher discount rate lowers value, higher growth raises it", () => {
    const v = (p: Partial<DcfParams>) => equityDcf({ ...base, ...p }).perShare;
    expect(v({ discountRate: 0.12 })).toBeLessThan(v({}));
    expect(v({ growth: 0.08 })).toBeGreaterThan(v({}));
  });

  it("returns 0 per share when shares are missing", () => {
    expect(equityDcf({ ...base, shares: 0 }).perShare).toBe(0);
  });
});

describe("sensitivityGrid", () => {
  it("brackets the central value and reports the swing", () => {
    const s = sensitivityGrid(base);
    expect(s.ivLow).toBeLessThanOrEqual(s.central);
    expect(s.ivHigh).toBeGreaterThanOrEqual(s.central);
    expect(s.swingPct).toBeGreaterThan(0);
  });
});

describe("ownerEarningsMultiple", () => {
  it("is OE per share x multiple", () => {
    expect(ownerEarningsMultiple(100, 10, 12.5)).toBeCloseTo(125, 10);
    expect(ownerEarningsMultiple(100, 0, 12.5)).toBe(0);
  });
});

describe("grahamNumber", () => {
  it("is sqrt(22.5 x EPS x BVPS)", () => {
    expect(grahamNumber(2, 10)).toBeCloseTo(Math.sqrt(450), 10);
  });
  it("rejects invalid inputs", () => {
    expect(grahamNumber(null, 10)).toBeNull();
    expect(grahamNumber(-1, 10)).toBeNull();
    expect(grahamNumber(2, 0)).toBeNull();
  });
});

describe("impliedGrowth", () => {
  it("recovers the growth that produced a given price (reverse-DCF roundtrip)", () => {
    const g = 0.05;
    const price = equityDcf({ ...base, growth: g }).perShare;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { growth: _g, ...noGrowth } = base;
    expect(impliedGrowth(price, noGrowth)!).toBeCloseTo(g, 3);
  });
  it("is null for a non-positive price", () => {
    const { growth: _g, ...noGrowth } = base;
    void _g;
    expect(impliedGrowth(0, noGrowth)).toBeNull();
  });
});

describe("qualityTier", () => {
  it("maps ROE/margin to tiers", () => {
    expect(qualityTier(20, 15)).toBe("wide");
    expect(qualityTier(13, 9)).toBe("solid");
    expect(qualityTier(9, 5)).toBe("average");
    expect(qualityTier(5, 2)).toBe("narrow");
    expect(qualityTier(1, 1)).toBe("cyclical");
    expect(qualityTier(null, null)).toBe("cyclical");
  });
});
