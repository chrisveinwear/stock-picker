/**
 * Pure DCF / triangulation maths — the ONLY implementation of MODEL_TEMPLATE
 * (model-template.ts). No I/O, no fetching: same inputs always produce the same
 * output. All monetary inputs/outputs are in one (price) currency.
 *
 * Basis (dcf-v2): owner earnings are a LEVERED equity cash flow (net income is
 * post-interest), so they are discounted at the cost of equity and the present
 * value IS equity value. No WACC, no net-debt subtraction — subtracting net debt
 * from a levered-cash-flow PV would count debt twice.
 */
import { MODEL_TEMPLATE } from "./model-template";

/** CAPM cost of equity. Beta must already be sanitised by the caller. */
export function costOfEquity(p: {
  beta: number;
  riskFreeRate: number;
  equityRiskPremium: number;
}): number {
  return p.riskFreeRate + p.beta * p.equityRiskPremium;
}

export type DcfParams = {
  baseOwnerEarnings: number;
  growth: number;          // stage-1 annual growth (year 1); fades to terminalGrowth
  years: number;           // explicit horizon
  terminalGrowth: number;
  discountRate: number;    // cost of equity
  exitMultiple: number;    // applied to terminal-year owner earnings
  shares: number;
};

export type DcfResult = {
  perShare: number;
  equityValue: number;
  pvExplicit: number;
  pvTerminal: number;
  tvPerpetuity: number;
  tvExit: number;
  /** True when the perpetuity spread (r − g) had to be floored — treat with care. */
  tvSpreadFloored: boolean;
};

/**
 * Growth applied in year y (1-based): stage-1 growth fading linearly into the
 * terminal rate by the final explicit year, so the terminal value doesn't sit on
 * an abrupt growth cliff.
 */
export function fadedGrowth(y: number, years: number, g1: number, gT: number): number {
  if (years <= 1) return g1;
  const t = (y - 1) / (years - 1);
  return g1 + (gT - g1) * t;
}

export function equityDcf(p: DcfParams): DcfResult {
  const { baseOwnerEarnings: base, growth, years, terminalGrowth, discountRate, exitMultiple, shares } = p;
  let pvExplicit = 0;
  let oe = base;
  for (let y = 1; y <= years; y++) {
    oe *= 1 + fadedGrowth(y, years, growth, terminalGrowth);
    pvExplicit += oe / Math.pow(1 + discountRate, y);
  }
  const terminalOE = oe;
  // Perpetuity growth, with a floored spread so a discountRate<=g case can't explode.
  const rawSpread = discountRate - terminalGrowth;
  const spread = Math.max(rawSpread, 0.01);
  const tvPerpetuity = (terminalOE * (1 + terminalGrowth)) / spread;
  const tvExit = terminalOE * exitMultiple;
  const tv = (tvPerpetuity + tvExit) / 2;
  const pvTerminal = tv / Math.pow(1 + discountRate, years);
  const equityValue = pvExplicit + pvTerminal;
  return {
    perShare: shares > 0 ? equityValue / shares : 0,
    equityValue,
    pvExplicit,
    pvTerminal,
    tvPerpetuity,
    tvExit,
    tvSpreadFloored: rawSpread < 0.01,
  };
}

export type Sensitivity = {
  ivLow: number;
  ivHigh: number;
  central: number;
  swingPct: number;
  lowConfidence: boolean;
};

/** IV low/high from the canonical sensitivity grid (discount-rate & terminal-growth deltas). */
export function sensitivityGrid(p: DcfParams): Sensitivity {
  const { discountRateDeltas, terminalGrowthDeltas, lowConfidenceSwingPct } = MODEL_TEMPLATE.sensitivity;
  const vals: number[] = [];
  for (const dr of discountRateDeltas) {
    for (const dg of terminalGrowthDeltas) {
      vals.push(
        equityDcf({ ...p, discountRate: p.discountRate + dr, terminalGrowth: p.terminalGrowth + dg }).perShare
      );
    }
  }
  const central = equityDcf(p).perShare;
  const ivLow = Math.min(...vals);
  const ivHigh = Math.max(...vals);
  const swingPct = central !== 0 ? ((ivHigh - ivLow) / Math.abs(central)) * 100 : 0;
  return { ivLow, ivHigh, central, swingPct, lowConfidence: swingPct > lowConfidenceSwingPct };
}

/** Owner-earnings multiple method: IV/share = (owner earnings / shares) x multiple. */
export function ownerEarningsMultiple(baseOwnerEarnings: number, shares: number, multiple: number): number {
  return shares > 0 ? (baseOwnerEarnings / shares) * multiple : 0;
}

/**
 * Graham number: sqrt(22.5 x EPS x book value per share). The 22.5 constant is
 * 15x earnings x 1.5x book on ACTUAL net earnings — callers must pass real
 * trailing EPS, not owner earnings per share. Null if inputs invalid.
 */
export function grahamNumber(eps: number | null, bookValuePerShare: number | null): number | null {
  if (eps == null || bookValuePerShare == null || eps <= 0 || bookValuePerShare <= 0) return null;
  return Math.sqrt(22.5 * eps * bookValuePerShare);
}

/** Reverse-DCF: the stage-1 growth implied by the current market price. */
export function impliedGrowth(price: number, p: Omit<DcfParams, "growth">): number | null {
  if (price <= 0) return null;
  let lo = -0.2, hi = 0.4;
  const f = (g: number) => equityDcf({ ...p, growth: g }).perShare - price;
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
