import { describe, expect, it } from "vitest";
import { resolveReportThresholds } from "./report-thresholds";
import { marginOfSafetyPct, midpointIv } from "./mos";

describe("resolveReportThresholds", () => {
  const consensus = { consensusBuyBelow: 8.3, consensusSellAbove: 10.5 };

  it("rejects an equity model whose fair value diverges from the IV midpoint (APA regression)", () => {
    // dcf-v2 once said APA was worth $1.98 against a reconciled IV of 8.50–10.50,
    // which stored "sell above $2.57" and fired a false sell alert at $9.84.
    const r = resolveReportThresholds({
      model: { kind: "equity", fairValue: 1.98, buyBelow: 1.39, sellAbove: 2.57, lowConfidence: false },
      ...consensus,
      ivLow: 8.5,
      ivHigh: 10.5,
      isCommodity: false,
    });
    expect(r.source).toBe("consensus");
    expect(r.modelRejectedReason).toMatch(/diverges/);
    expect(r.buyBelow).toBe(8.3);
    expect(r.sellAbove).toBe(10.5);
  });

  it("rejects an equity model that flags low confidence", () => {
    const r = resolveReportThresholds({
      model: { kind: "equity", fairValue: 9.5, buyBelow: 6.65, sellAbove: 12.35, lowConfidence: true },
      ...consensus,
      ivLow: 8.5,
      ivHigh: 10.5,
      isCommodity: false,
    });
    expect(r.source).toBe("consensus");
    expect(r.modelRejectedReason).toMatch(/low confidence/);
  });

  it("uses a credible equity model, clamped to the IV range", () => {
    const r = resolveReportThresholds({
      model: { kind: "equity", fairValue: 108.13, buyBelow: 75.69, sellAbove: 140.57, lowConfidence: false },
      consensusBuyBelow: 107,
      consensusSellAbove: 165,
      ivLow: 100,
      ivHigh: 165,
      isCommodity: false,
    });
    expect(r.source).toBe("model");
    expect(r.buyBelow).toBe(75.69); // already ≤ ivLow
    expect(r.sellAbove).toBe(165); // clamped up to the fair-value ceiling
  });

  it("clamps the consensus path too (buy trigger can't sit above the IV floor)", () => {
    const r = resolveReportThresholds({
      model: null,
      consensusBuyBelow: 6.84,
      consensusSellAbove: 7.5,
      ivLow: 6.1,
      ivHigh: 8.0,
      isCommodity: false,
    });
    expect(r.buyBelow).toBe(6.1);
    expect(r.sellAbove).toBe(8.0);
  });

  it("leaves commodity incentive zones unclamped and always trusts them", () => {
    // GOLD: incentive-price "IV" 1560–2550 with buy/sell zones legitimately above it.
    const r = resolveReportThresholds({
      model: { kind: "commodity", fairValue: 2550, buyBelow: 2550, sellAbove: 3315, lowConfidence: false },
      consensusBuyBelow: null,
      consensusSellAbove: null,
      ivLow: 1560,
      ivHigh: 2550,
      isCommodity: true,
    });
    expect(r.source).toBe("model");
    expect(r.buyBelow).toBe(2550); // NOT clamped down to ivLow
    expect(r.sellAbove).toBe(3315);
  });
});

describe("marginOfSafetyPct", () => {
  it("is the % discount to the IV midpoint", () => {
    // APA report convention: price 9.81 vs IV 8.50–10.50 (midpoint 9.50) = −3.26%.
    expect(marginOfSafetyPct(8.5, 10.5, 9.81)).toBeCloseTo(-3.26, 1);
    expect(marginOfSafetyPct(100, 165, 92.75)).toBeCloseTo(30, 5);
  });

  it("falls back to the single bound when only one is present", () => {
    expect(midpointIv(null, 10)).toBe(10);
    expect(midpointIv(8, null)).toBe(8);
    expect(marginOfSafetyPct(null, 10, 7)).toBeCloseTo(30, 5);
  });

  it("returns null without a usable price or IV", () => {
    expect(marginOfSafetyPct(8.5, 10.5, null)).toBeNull();
    expect(marginOfSafetyPct(8.5, 10.5, 0)).toBeNull();
    expect(marginOfSafetyPct(null, null, 9.81)).toBeNull();
  });
});
