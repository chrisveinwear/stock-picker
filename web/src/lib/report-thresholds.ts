/**
 * Single decision point for the buy/sell alert thresholds stored on a research
 * report row — used by the generate route at save time and by the backfill
 * script when re-deriving historical rows.
 *
 * Preference order:
 *  1. The deterministic code model, when credible. Commodity incentive zones
 *     (maintained cost curve) are always credible. An equity model is rejected
 *     when it flags low confidence or its fair value sits further than
 *     CODE_THRESHOLD_MAX_DIVERGENCE from the report's reconciled IV midpoint —
 *     dcf-v2 badly undershoots leveraged/capital-intensive names (APA once
 *     alerted "sell above $2.57" against an $8.50–10.50 IV range).
 *  2. The report's lens-consensus numbers.
 *
 * Whatever the source, stock thresholds are clamped to the report's IV range:
 * a sell trigger can never sit below the fair-value ceiling, nor a buy trigger
 * above the floor. Commodity zones are exempt — the incentive band
 * legitimately sits above the incentive-price range stored as the "IV".
 */

export type ThresholdModel = {
  kind: "equity" | "commodity";
  fairValue: number;
  buyBelow: number;
  sellAbove: number;
  lowConfidence: boolean;
};

export type ResolvedThresholds = {
  buyBelow: number | null;
  sellAbove: number | null;
  source: "model" | "consensus";
  /** Set when a model was supplied but rejected in favour of the consensus. */
  modelRejectedReason: string | null;
};

/** Max |code fair value − IV midpoint| / midpoint before the model is rejected. */
export const CODE_THRESHOLD_MAX_DIVERGENCE = 0.5;

export function resolveReportThresholds(args: {
  model: ThresholdModel | null;
  consensusBuyBelow: number | null;
  consensusSellAbove: number | null;
  ivLow: number | null;
  ivHigh: number | null;
  isCommodity: boolean;
}): ResolvedThresholds {
  const { model, consensusBuyBelow, consensusSellAbove, ivLow, ivHigh, isCommodity } = args;
  const ivMid = ivLow != null && ivHigh != null ? (ivLow + ivHigh) / 2 : ivHigh ?? ivLow;

  let modelRejectedReason: string | null = null;
  if (model && model.kind === "equity") {
    if (model.lowConfidence) {
      modelRejectedReason = "model flags low confidence (sensitivity swing)";
    } else if (
      ivMid != null &&
      ivMid > 0 &&
      Math.abs(model.fairValue - ivMid) / ivMid > CODE_THRESHOLD_MAX_DIVERGENCE
    ) {
      modelRejectedReason = `model fair value ${model.fairValue.toFixed(2)} diverges >${(CODE_THRESHOLD_MAX_DIVERGENCE * 100).toFixed(0)}% from IV midpoint ${ivMid.toFixed(2)}`;
    }
  }

  let buyBelow: number | null;
  let sellAbove: number | null;
  let source: "model" | "consensus";
  if (model && modelRejectedReason == null) {
    buyBelow = Number(model.buyBelow.toFixed(2));
    sellAbove = Number(model.sellAbove.toFixed(2));
    source = "model";
  } else {
    buyBelow = consensusBuyBelow;
    sellAbove = consensusSellAbove;
    source = "consensus";
  }

  if (!isCommodity) {
    if (sellAbove != null && ivHigh != null && sellAbove < ivHigh) sellAbove = ivHigh;
    if (buyBelow != null && ivLow != null && buyBelow > ivLow) buyBelow = ivLow;
  }

  return { buyBelow, sellAbove, source, modelRejectedReason };
}
