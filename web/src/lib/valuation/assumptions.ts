/**
 * Valuation assumptions — git-versioned file defaults, optionally overridden by
 * rows in the `valuation_assumptions` DB table. The resolver merges
 * defaults <- sector <- ticker (most specific wins) and tags every value with its
 * source for provenance/audit. Assumptions are INPUTS to the model template; they
 * are not the model structure (see model-template.ts).
 */
import { getDb } from "@/db";
import { valuationAssumptions } from "@/db/schema";

export type AssumptionSource = "default" | "sector" | "ticker" | "derived";

export type Tagged = { value: number; source: AssumptionSource; note?: string };

/** Standing macro + model defaults (the audit baseline). Edit here = git commit. */
export const DEFAULTS = {
  riskFreeRate: 0.043,        // AU 10yr government bond ~4.3%
  equityRiskPremium: 0.055,   // long-run market premium
  terminalGrowth: 0.025,      // ~GDP/inflation
  taxRate: 0.30,              // AU corporate rate (fallback if not derivable)
  costOfDebtFallback: 0.06,
  stage1Growth: 0.04,        // used only when no analyst estimate is available
  exitMultipleEbit: 12,      // terminal EV/owner-earnings exit multiple
  marginOfSafety: 0.30,      // standing 30% MOS (CLAUDE.md)
} as const;

export type AssumptionKey = keyof typeof DEFAULTS;

/** Owner-earnings multiple by quality tier (from buffett 06-valuation-capital). */
export const QUALITY_MULTIPLES: Record<string, number> = {
  wide: 22,      // wide moat + growth + asset-light (20-25x)
  solid: 17,     // solid moat, moderate growth (15-20x)
  average: 12.5, // average moat, low growth (10-15x)
  narrow: 10,    // narrow moat / competitive threats (8-12x)
  cyclical: 7,   // cyclical / declining (<8x)
};

/** Sector-level file overrides (kept minimal; extend as needed). */
const SECTOR_OVERRIDES: Record<string, Partial<Record<AssumptionKey, number>>> = {
  // e.g. "Financial Services": { terminalGrowth: 0.03 },
};

/**
 * Resolve the full assumption set for a ticker. DB rows (scope = ticker | sector
 * | "global") override file defaults; ticker beats sector beats global.
 */
export function resolveAssumptions(
  ticker: string,
  sector?: string | null
): Record<AssumptionKey, Tagged> {
  // Start from file defaults.
  const out = {} as Record<AssumptionKey, Tagged>;
  (Object.keys(DEFAULTS) as AssumptionKey[]).forEach((k) => {
    out[k] = { value: DEFAULTS[k], source: "default" };
  });

  // File sector overrides.
  if (sector && SECTOR_OVERRIDES[sector]) {
    for (const [k, v] of Object.entries(SECTOR_OVERRIDES[sector])) {
      if (v != null) out[k as AssumptionKey] = { value: v, source: "sector" };
    }
  }

  // DB overrides (global -> sector -> ticker, most specific last so it wins).
  try {
    const db = getDb();
    const rows = db.select().from(valuationAssumptions).all();
    const scopeRank: Record<string, number> = { global: 1 };
    if (sector) scopeRank[sector] = 2;
    scopeRank[ticker.toUpperCase()] = 3;
    const best: Record<string, { value: number; rank: number; scope: string }> = {};
    for (const r of rows) {
      const rank = scopeRank[r.scope] ?? (r.scope === ticker.toUpperCase() ? 3 : 0);
      if (rank === 0) continue; // not applicable to this ticker
      if (!best[r.key] || rank >= best[r.key].rank) {
        best[r.key] = { value: r.value, rank, scope: r.scope };
      }
    }
    for (const [k, v] of Object.entries(best)) {
      if (k in out) {
        out[k as AssumptionKey] = {
          value: v.value,
          source: v.scope === "global" ? "default" : v.scope === sector ? "sector" : "ticker",
          note: `db override (${v.scope})`,
        };
      }
    }
  } catch {
    // table missing / DB error — fall back to file defaults silently
  }

  return out;
}
