/**
 * Pure DCF / triangulation maths — the ONLY implementation of MODEL_TEMPLATE
 * (model-template.ts). No I/O, no fetching: same inputs always produce the same
 * output. All monetary inputs/outputs are in one (price) currency.
 */
import { MODEL_TEMPLATE } from "./model-template";

export function wacc(p: {
  beta: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  costOfDebt: number;
  taxRate: number;
  equityValue: number; // market value of equity
  debtValue: number;   // gross/net debt used for weighting
}): number {
  const re = p.riskFreeRate + p.beta * p.equityRiskPremium;
  const rdAfterTax = p.costOfDebt * (1 - p.taxRate);
  const e = Math.max(p.equityValue, 0);
  const d = Math.max(p.debtValue, 0);
  const v = e + d || 1;
  return (e / v) * re + (d / v) * rdAfterTax;
}

export type DcfParams = {
  baseOwnerEarnings: number;
  growth: number;          // stage-1 annual growth
  years: number;           // explicit horizon
  terminalGrowth: number;
  wacc: number;
  exitMultiple: number;    // applied to terminal-year owner earnings
  netDebt: number;
  shares: number;
};

export type DcfResult = {
  perShare: number;
  enterpriseValue: number;
  equityValue: number;
  pvExplicit: number;
  pvTerminal: number;
  tvPerpetuity: number;
  tvExit: number;
};

export function twoStageDcf(p: DcfParams): DcfResult {
  const { baseOwnerEarnings: base, growth, years, terminalGrowth, wacc, exitMultiple, netDebt, shares } = p;
  let pvExplicit = 0;
  let oe = base;
  for (let y = 1; y <= years; y++) {
    oe = base * Math.pow(1 + growth, y);
    pvExplicit += oe / Math.pow(1 + wacc, y);
  }
  const terminalOE = base * Math.pow(1 + growth, years);
  // Perpetuity growth, with a floored spread so a WACC<=g case can't explode.
  const spread = Math.max(wacc - terminalGrowth, 0.01);
  const tvPerpetuity = (terminalOE * (1 + terminalGrowth)) / spread;
  const tvExit = terminalOE * exitMultiple;
  const tv = (tvPerpetuity + tvExit) / 2;
  const pvTerminal = tv / Math.pow(1 + wacc, years);
  const enterpriseValue = pvExplicit + pvTerminal;
  const equityValue = enterpriseValue - netDebt;
  return {
    perShare: shares > 0 ? equityValue / shares : 0,
    enterpriseValue,
    equityValue,
    pvExplicit,
    pvTerminal,
    tvPerpetuity,
    tvExit,
  };
}

export type Sensitivity = {
  ivLow: number;
  ivHigh: number;
  central: number;
  swingPct: number;
  lowConfidence: boolean;
};

/** IV low/high from the canonical sensitivity grid (WACC & terminal-growth deltas). */
export function sensitivityGrid(p: DcfParams): Sensitivity {
  const { waccDeltas, terminalGrowthDeltas, lowConfidenceSwingPct } = MODEL_TEMPLATE.sensitivity;
  const vals: number[] = [];
  for (const dw of waccDeltas) {
    for (const dg of terminalGrowthDeltas) {
      vals.push(twoStageDcf({ ...p, wacc: p.wacc + dw, terminalGrowth: p.terminalGrowth + dg }).perShare);
    }
  }
  const central = twoStageDcf(p).perShare;
  const ivLow = Math.min(...vals);
  const ivHigh = Math.max(...vals);
  const swingPct = central !== 0 ? ((ivHigh - ivLow) / Math.abs(central)) * 100 : 0;
  return { ivLow, ivHigh, central, swingPct, lowConfidence: swingPct > lowConfidenceSwingPct };
}

/** Owner-earnings multiple method: IV/share = (owner earnings / shares) x multiple. */
export function ownerEarningsMultiple(baseOwnerEarnings: number, shares: number, multiple: number): number {
  return shares > 0 ? (baseOwnerEarnings / shares) * multiple : 0;
}

/** Graham number: sqrt(22.5 x EPS x book value per share). Null if inputs invalid. */
export function grahamNumber(eps: number | null, bookValuePerShare: number | null): number | null {
  if (eps == null || bookValuePerShare == null || eps <= 0 || bookValuePerShare <= 0) return null;
  return Math.sqrt(22.5 * eps * bookValuePerShare);
}

/** Reverse-DCF: the stage-1 growth implied by the current market price. */
export function impliedGrowth(price: number, p: Omit<DcfParams, "growth">): number | null {
  if (price <= 0) return null;
  let lo = -0.2, hi = 0.4;
  const f = (g: number) => twoStageDcf({ ...p, growth: g }).perShare - price;
  if (f(lo) > 0) return lo; // even no growth overshoots
  if (f(hi) < 0) return hi; // even high growth undershoots
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Map fetched quality metrics to an owner-earnings multiple tier (deterministic). */
export function qualityTier(roePct: number | null, netMarginPct: number | null): string {
  const roe = roePct ?? 0;
  const nm = netMarginPct ?? 0;
  if (roe >= 15 && nm >= 12) return "wide";
  if (roe >= 12 && nm >= 8) return "solid";
  if (roe >= 8) return "average";
  if (roe >= 4) return "narrow";
  return "cyclical";
}
