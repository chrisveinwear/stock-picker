/**
 * Equity valuation orchestrator. Pulls verified inputs, resolves assumptions,
 * runs the canonical DCF/triangulation template, and returns a fully
 * provenance-tagged, reproducible ValuationResult stamped with the model version.
 */
import { MODEL_VERSION } from "./model-template";
import { getValuationInputs, type ValuationInputs } from "./inputs";
import { resolveAssumptions, QUALITY_MULTIPLES, type Tagged } from "./assumptions";
import {
  wacc as computeWacc,
  twoStageDcf,
  sensitivityGrid,
  ownerEarningsMultiple,
  grahamNumber,
  impliedGrowth,
  qualityTier,
  type DcfParams,
} from "./dcf";

export type ValuationResult = {
  modelVersion: string;
  ticker: string;
  runAt: string;
  ok: boolean;
  currency: string;
  price: number;
  codeIvLow: number;
  codeIvHigh: number;
  codeFairValue: number;
  wacc: number;
  qualityTier: string;
  ownerEarningsMultiple: number;
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
  const a = resolveAssumptions(ticker, sector);
  const warnings = [...inputs.warnings];

  const equityValue = inputs.price * inputs.sharesOutstanding;
  const rawWacc = computeWacc({
    beta: inputs.beta,
    riskFreeRate: a.riskFreeRate.value,
    equityRiskPremium: a.equityRiskPremium.value,
    costOfDebt: inputs.costOfDebt,
    taxRate: inputs.taxRate,
    equityValue,
    debtValue: Math.max(inputs.netDebt, 0),
  });
  // Floor at 8% (risk-free + ~3-5% company premium per philosophy; also avoids the
  // degenerate low-beta / over-levered case discounting equity cash flows too cheaply).
  const wacc = clamp(rawWacc, 0.08, 0.16);
  if (wacc !== rawWacc) warnings.push(`WACC ${(rawWacc * 100).toFixed(1)}% adjusted to ${(wacc * 100).toFixed(1)}% (floored at 8% per discount-rate policy).`);

  const params: DcfParams = {
    baseOwnerEarnings: inputs.baseOwnerEarnings,
    growth: a.stage1Growth.value,
    years: 10,
    terminalGrowth: a.terminalGrowth.value,
    wacc,
    exitMultiple: a.exitMultipleEbit.value,
    netDebt: inputs.netDebt,
    shares: inputs.sharesOutstanding,
  };

  const sens = sensitivityGrid(params);
  if (sens.lowConfidence) warnings.push(`IV swings ${sens.swingPct.toFixed(0)}% across the sensitivity grid — low confidence; widen margin of safety.`);

  const tier = qualityTier(inputs.returnOnEquityPct, inputs.profitMarginsPct);
  const multiple = QUALITY_MULTIPLES[tier];
  const oeMultIV = ownerEarningsMultiple(inputs.baseOwnerEarnings, inputs.sharesOutstanding, multiple);
  const nEps = inputs.sharesOutstanding > 0 ? inputs.baseOwnerEarnings / inputs.sharesOutstanding : 0;
  const graham = grahamNumber(nEps, inputs.bookValuePerShare);
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
    modelVersion: MODEL_VERSION,
    ticker,
    runAt: new Date().toISOString(),
    ok: inputs.ok,
    currency: inputs.priceCurrency,
    price: inputs.price,
    codeIvLow,
    codeIvHigh,
    codeFairValue,
    wacc,
    qualityTier: tier,
    ownerEarningsMultiple: multiple,
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
    warnings,
  };
}
