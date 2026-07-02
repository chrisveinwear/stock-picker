/**
 * Equity valuation orchestrator. Pulls verified inputs, resolves assumptions,
 * runs the canonical DCF/triangulation template, and returns a fully
 * provenance-tagged, reproducible ValuationResult stamped with the model version.
 */
import { MODEL_VERSION } from "./model-template";
import { getValuationInputs, type ValuationInputs } from "./inputs";
import { resolveAssumptions, QUALITY_MULTIPLES, DEFAULTS, type Tagged } from "./assumptions";
import {
  costOfEquity as computeCostOfEquity,
  equityDcf,
  sensitivityGrid,
  ownerEarningsMultiple,
  grahamNumber,
  impliedGrowth,
  qualityTier,
  type DcfParams,
} from "./dcf";
import type { FinancialYear } from "@/lib/yahoo-finance";

export type ValuationResult = {
  kind: "equity";
  modelVersion: string;
  ticker: string;
  runAt: string;
  ok: boolean;
  currency: string;
  price: number;
  codeIvLow: number;
  codeIvHigh: number;
  codeFairValue: number;
  /** CAPM cost of equity used to discount the (levered) owner earnings. */
  discountRate: number;
  qualityTier: string;
  ownerEarningsMultiple: number;
  /** Terminal exit multiple actually applied (tier-derived unless overridden). */
  exitMultiple: number;
  /** Stage-1 growth actually applied (analyst-derived when possible). */
  stage1Growth: number;
  netDebt: number;
  methods: {
    dcf: number;
    ownerEarningsMultiple: number;
    graham: number | null;
    impliedGrowth: number | null;
  };
  analystTargetMean: number | null;
  baseOwnerEarnings: number;
  baseBasis: string;
  sensitivity: { ivLow: number; ivHigh: number; central: number; swingPct: number; lowConfidence: boolean };
  assumptions: Record<string, Tagged>;
  inputsProvenance: ValuationInputs["provenance"];
  /** Annual statement history the inputs were derived from (for prompt injection). */
  history: FinancialYear[];
  warnings: string[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const median = (xs: number[]): number => {
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export async function runEquityValuation(
  ticker: string,
  sector?: string | null
): Promise<ValuationResult> {
  const inputs = await getValuationInputs(ticker);
  const a = resolveAssumptions(ticker, sector ?? inputs.sector);
  const warnings = [...inputs.warnings];

  // Discount rate: CAPM cost of equity on the sanitised beta, clamped into the
  // policy band. Owner earnings are post-interest, so no WACC blending and no
  // further net-debt deduction (that would double-count debt).
  const rawCoe = computeCostOfEquity({
    beta: inputs.beta,
    riskFreeRate: a.riskFreeRate.value,
    equityRiskPremium: a.equityRiskPremium.value,
  });
  const discountRate = clamp(rawCoe, a.discountRateFloor.value, a.discountRateCeiling.value);
  if (discountRate !== rawCoe) {
    warnings.push(
      `Cost of equity ${(rawCoe * 100).toFixed(1)}% adjusted to ${(discountRate * 100).toFixed(1)}% (policy band ${(a.discountRateFloor.value * 100).toFixed(0)}–${(a.discountRateCeiling.value * 100).toFixed(0)}%).`
    );
  }

  // Stage-1 growth: derived from the analyst forward vs trailing EPS when both
  // are usable; otherwise the file/DB assumption. Explicit DB/sector overrides win.
  let stage1: Tagged = a.stage1Growth;
  const growthOverridden = a.stage1Growth.source !== "default";
  if (!growthOverridden && inputs.epsForward != null && inputs.epsTrailing != null && inputs.epsTrailing > 0 && inputs.epsForward > 0) {
    const g = clamp(inputs.epsForward / inputs.epsTrailing - 1, a.stage1GrowthMin.value, a.stage1GrowthMax.value);
    stage1 = { value: g, source: "derived", note: "analyst forward vs trailing EPS, clamped" };
  }
  a.stage1Growth = stage1;

  // Terminal exit multiple: derived from the quality tier (clamped into the
  // policy band) unless explicitly overridden in the DB/sector layer.
  const tier = qualityTier(inputs.returnOnEquityPct, inputs.profitMarginsPct);
  const tierMultiple = QUALITY_MULTIPLES[tier] ?? DEFAULTS.exitMultiple;
  if (a.exitMultiple.source === "default") {
    a.exitMultiple = {
      value: clamp(tierMultiple, a.exitMultipleMin.value, a.exitMultipleMax.value),
      source: "derived",
      note: `quality tier "${tier}" multiple, clamped`,
    };
  }

  const params: DcfParams = {
    baseOwnerEarnings: inputs.baseOwnerEarnings,
    growth: stage1.value,
    years: 10,
    terminalGrowth: a.terminalGrowth.value,
    discountRate,
    exitMultiple: a.exitMultiple.value,
    shares: inputs.sharesOutstanding,
  };

  const central = equityDcf(params);
  if (central.tvSpreadFloored) {
    warnings.push("Perpetuity spread (discount rate − terminal growth) was floored at 1% — terminal value is capped, not exploded.");
  }
  const sens = sensitivityGrid(params);
  if (sens.lowConfidence) warnings.push(`IV swings ${sens.swingPct.toFixed(0)}% across the sensitivity grid — low confidence; widen margin of safety.`);

  const multiple = QUALITY_MULTIPLES[tier];
  const oeMultIV = ownerEarningsMultiple(inputs.baseOwnerEarnings, inputs.sharesOutstanding, multiple);
  // Graham number takes ACTUAL trailing EPS (reconciled to the price currency) —
  // its 22.5 constant is calibrated to net earnings, not owner earnings.
  const graham = grahamNumber(inputs.epsTrailing, inputs.bookValuePerShare);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { growth: _g, ...noGrowth } = params;
  const implied = impliedGrowth(inputs.price, noGrowth);

  // Triangulated fair value = median of the methods (robust to any single method
  // — e.g. a terminal-heavy DCF — blowing up). IV range spans the method spread
  // and the DCF sensitivity bounds, so the published range reflects real uncertainty.
  const methodValues = [sens.central, oeMultIV, ...(graham != null ? [graham] : [])].filter(
    (v) => Number.isFinite(v) && v > 0
  );
  const codeFairValue = methodValues.length ? median(methodValues) : sens.central;
  const codeIvLow = Math.min(...methodValues, sens.ivLow);
  const codeIvHigh = Math.max(...methodValues, sens.ivHigh);

  return {
    kind: "equity",
    modelVersion: MODEL_VERSION,
    ticker,
    runAt: new Date().toISOString(),
    ok: inputs.ok,
    currency: inputs.priceCurrency,
    price: inputs.price,
    codeIvLow,
    codeIvHigh,
    codeFairValue,
    discountRate,
    qualityTier: tier,
    ownerEarningsMultiple: multiple,
    exitMultiple: a.exitMultiple.value,
    stage1Growth: stage1.value,
    netDebt: inputs.netDebt,
    methods: {
      dcf: sens.central,
      ownerEarningsMultiple: oeMultIV,
      graham,
      impliedGrowth: implied,
    },
    analystTargetMean: inputs.analystTargetMean,
    baseOwnerEarnings: inputs.baseOwnerEarnings,
    baseBasis: inputs.baseBasis,
    sensitivity: sens,
    assumptions: a,
    inputsProvenance: inputs.provenance,
    history: inputs.history,
    warnings,
  };
}
