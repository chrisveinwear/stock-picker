import { describe, it, expect } from "vitest";
import { reconcileEps } from "./inputs";

describe("reconcileEps", () => {
  const price = 27.96;
  const pe = 10; // implied EPS 2.796

  it("accepts an EPS that matches price/PE", () => {
    const r = reconcileEps({ eps: 2.8, price, pe, fxFinToPrice: 1.45 });
    expect(r.value).toBe(2.8);
    expect(r.note).toContain("verified");
  });

  it("FX-converts an EPS reported in the financial currency", () => {
    // 1.9 USD x 1.45 = 2.755 AUD ≈ implied 2.796
    const r = reconcileEps({ eps: 1.9, price, pe, fxFinToPrice: 1.45 });
    expect(r.value).toBeCloseTo(2.755, 10);
    expect(r.note).toContain("FX-converted");
  });

  it("falls back to the P/E-implied EPS when neither form is consistent", () => {
    const r = reconcileEps({ eps: 9, price, pe, fxFinToPrice: 1.45 });
    expect(r.value).toBeCloseTo(2.796, 10);
    expect(r.note).toContain("replaced");
  });

  it("passes an EPS through unverified when no P/E exists", () => {
    const r = reconcileEps({ eps: 2.5, price, pe: null, fxFinToPrice: 1.45 });
    expect(r.value).toBe(2.5);
    expect(r.note).toContain("unverified");
  });

  it("returns null for a missing EPS", () => {
    expect(reconcileEps({ eps: null, price, pe, fxFinToPrice: 1 }).value).toBeNull();
  });
});
