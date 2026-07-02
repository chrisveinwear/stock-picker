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
 *
 * dcf-v2 (structural changes vs dcf-v1):
 *   - Equity DCF: owner earnings are a LEVERED, post-interest cash flow, so they
 *     are discounted at the CAPM cost of equity and the result IS equity value.
 *     v1 discounted them at WACC and then subtracted net debt again — counting
 *     debt twice (once via interest inside net income, once as net debt).
 *   - Stage-1 growth fades linearly to terminal growth across the horizon
 *     (v1 held one flat rate for 10 years then jumped).
 *   - Stage-1 growth is derived from analyst forward vs trailing EPS when
 *     available; the exit multiple is derived from the quality tier (v1 used a
 *     flat 12x labelled "EBIT" but applied to owner earnings).
 *   - Graham number uses actual trailing EPS (v1 fed it owner earnings/share).
 */

export const MODEL_VERSION = "dcf-v2";

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
    discountRateDeltas: [-0.01, 0, 0.01] as const,
    terminalGrowthDeltas: [-0.005, 0, 0.005] as const,
    /** If IV swings more than this across the grid, flag low confidence. */
    lowConfidenceSwingPct: 15,
  },
  /** Ordered calculation steps (documentation of the fixed structure). */
  steps: [
    "Normalise base owner earnings (avoid trough TTM): median of the usable candidates — analyst forward net income (FX-validated), margin-normalised earnings, historical owner earnings (NI + D&A − capex, capex required), and historical free cash flow.",
    "Discount rate = CAPM cost of equity: riskFree + beta x ERP, with beta clamped to a sane band and the rate floored per the discount-rate policy. Owner earnings are post-interest (levered), so NO WACC and NO further net-debt subtraction — debt is already serviced inside the cash flow.",
    "Project owner earnings over the horizon with stage-1 growth fading linearly into the terminal growth rate; discount each year at the cost of equity.",
    "Terminal value via perpetuity-growth AND exit-multiple (quality-tier derived); average the two; discount to present.",
    "Equity value = sum of discounted flows (already an equity claim); per share = equity / shares; statement figures converted to the price currency via the fetched FX rate.",
    "Triangulate with owner-earnings multiple (quality-tier table) and the Graham number (actual trailing EPS x book value).",
    "Reverse-DCF: solve the stage-1 growth implied by the current market price (sanity check).",
    "IV low/high from the sensitivity grid (cost of equity +/-1%, terminal growth +/-0.5%) unioned with the method spread.",
  ],
  /** Keys present on every ValuationResult (structural contract). */
  outputSchema: [
    "codeIvLow",
    "codeIvHigh",
    "codeFairValue",
    "discountRate",
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
- Cash flow: normalised owner earnings — a LEVERED (post-interest, post-tax) equity cash flow.
- Discount rate: CAPM cost of equity (riskFree + beta x ERP). Because the cash flow is levered, net debt is NOT subtracted again — do not "correct" this by re-deducting debt.
- Stage-1 growth fades linearly into the terminal growth rate over the horizon.
- Terminal value: average of perpetuity-growth and a quality-tier exit multiple.
- Triangulation methods (all computed): ${t.methods.join(", ")}.
- IV range: derived from a sensitivity grid (cost of equity +/-1%, terminal growth +/-0.5%) plus the method spread.
Steps:
${t.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`;
}
