/**
 * Canonical valuation model template — the SINGLE source of truth for model
 * STRUCTURE. Every equity is valued through this exact structure; only the
 * assumption/input *values* differ per stock. This prevents per-stock structural
 * drift (stock A getting a 2-stage DCF, stock B an exit multiple, etc.).
 *
 * `dcf.ts` is the only implementation of this template. Bump MODEL_VERSION only
 * for a deliberate, uniform structural change — never per stock. Every report,
 * sidecar and result is stamped with the version it was produced under, so old
 * reports stay reproducible.
 */

export const MODEL_VERSION = "dcf-v1";

export const MODEL_TEMPLATE = {
  version: MODEL_VERSION,
  /** Explicit forecast horizon before terminal value. */
  horizonYears: 10,
  /** Terminal value is always computed BOTH ways and averaged. */
  terminalMethods: ["perpetuity-growth", "exit-multiple"] as const,
  /** The fixed triangulation set — every report computes all of these. */
  methods: ["dcf", "ownerEarningsMultiple", "graham", "reverseDcf"] as const,
  /** Sensitivity grid that derives the IV low/high range deterministically. */
  sensitivity: {
    waccDeltas: [-0.01, 0, 0.01] as const,
    terminalGrowthDeltas: [-0.005, 0, 0.005] as const,
    /** If IV swings more than this across the grid, flag low confidence. */
    lowConfidenceSwingPct: 15,
  },
  /** Ordered calculation steps (documentation of the fixed structure). */
  steps: [
    "Normalise base owner earnings (avoid trough TTM): prefer the median of normalised owner earnings; fall back to forward earnings then a margin-normalised figure.",
    "WACC via CAPM: cost of equity = riskFree + beta x ERP; blended with after-tax cost of debt by capital structure.",
    "Project base owner earnings over the horizon at stage-1 growth; discount each year at WACC.",
    "Terminal value via perpetuity-growth AND exit-multiple; average the two; discount to present.",
    "Equity value = enterprise value - net debt; per share = equity / shares; convert to the price currency via the fetched FX rate.",
    "Triangulate with owner-earnings multiple (quality-tier table) and the Graham/earnings-power number.",
    "Reverse-DCF: solve the growth rate implied by the current market price (sanity check).",
    "IV low/high from the sensitivity grid (WACC +/-1%, terminal growth +/-0.5%).",
  ],
  /** Keys present on every ValuationResult (structural contract). */
  outputSchema: [
    "codeIvLow",
    "codeIvHigh",
    "codeFairValue",
    "wacc",
    "methods",
    "impliedGrowth",
    "sensitivity",
  ] as const,
} as const;

export type ModelTemplate = typeof MODEL_TEMPLATE;

/** Human-readable description injected into the research prompt so the LLM's
 *  narrative follows the same canonical structure (it may argue assumptions,
 *  never structure). */
export function describeModelTemplate(): string {
  const t = MODEL_TEMPLATE;
  return `Canonical valuation model: ${t.version}
This is the FIXED valuation structure used for every stock — present your valuation using it and do NOT substitute a different structure. You may argue for different assumption VALUES, never a different model shape.
- Horizon: ${t.horizonYears}-year explicit forecast, then terminal value.
- Terminal value: average of perpetuity-growth and exit-multiple.
- Triangulation methods (all computed): ${t.methods.join(", ")}.
- WACC: CAPM cost of equity (riskFree + beta x ERP) blended with after-tax cost of debt.
- IV range: derived from a sensitivity grid (WACC +/-1%, terminal growth +/-0.5%).
Steps:
${t.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
}
