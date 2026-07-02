/**
 * Commodity incentive-price model — the deterministic valuation for physical
 * commodities. Commodities are priced by supply/demand at the marginal tonne, not
 * by discounted cash flows, so this is a cost-curve model, NOT a DCF:
 *
 *   - incentive price = the price that justifies new (greenfield) supply at ~15%
 *     IRR. It is the long-run equilibrium / fair value.
 *   - AISC percentiles (50th/90th) describe the cost curve: below the 90th-pct
 *     cost, high-cost producers curtail (a price floor); well above the incentive
 *     price, new supply gets built (oversupply → mean-reversion down).
 *
 * Cost-curve data is proprietary (Wood Mackenzie / CRU) and not available from a
 * free API, so per-commodity assumptions are MAINTAINED here (git-versioned) and
 * overridable in the DB — the analyst updates them as the cost curve shifts. Spot
 * is fetched live and compared against them. Same versioned, provenance-tagged,
 * inject/reconcile/sidecar pattern as the equity engine.
 */
import { getCommodityPriceHistory } from "@/lib/yahoo-finance";
import { getDb } from "@/db";
import { valuationAssumptions } from "@/db/schema";
import type { Tagged } from "./assumptions";

export const COMMODITY_MODEL_VERSION = "incentive-v1";

export type CommodityDefaults = {
  unit: string;          // e.g. "USD/oz", "USD/bbl", "USD/lb", "USD/t"
  aisc50: number;        // 50th-percentile all-in sustaining cost
  aisc90: number;        // 90th-percentile AISC (cost-curve ceiling / curtailment floor)
  incentivePrice: number;// greenfield 15% IRR — long-run equilibrium / fair value
  overvaluedBand: number;// fraction above incentive that signals oversupply risk
  mos: number;           // buy discount to incentive price
  thesis: string;        // "monetary" | "industrial" | "energy" | "transition"
  asOf: string;          // YYYY-MM the estimates were last researched/refreshed
  source: string;        // where the estimates came from (audit trail)
};

/** Maintained estimates older than this are flagged stale in every valuation. */
export const COST_CURVE_STALE_MONTHS = 12;

/** Whole months between an "YYYY-MM"(-DD) stamp and now; Infinity if unparseable. */
export function costCurveAgeMonths(asOf: string, now: Date = new Date()): number {
  const m = asOf.match(/^(\d{4})-(\d{2})/);
  if (!m) return Infinity;
  return (now.getFullYear() - Number(m[1])) * 12 + (now.getMonth() + 1 - Number(m[2]));
}

/**
 * Maintained cost-curve estimates (UPDATE as the curve shifts — these are not
 * live data). Keyed by the report ticker convention (GOLD, OIL, …). Aliases below.
 *
 * Refreshed 2026-07 from dated 2025–2026 sources (web research). Where a
 * percentile/incentive figure is not published openly it is derived, and the
 * derivation is recorded in `source`. Every valuation run warns once the
 * vintage exceeds COST_CURVE_STALE_MONTHS.
 */
export const COMMODITY_DEFAULTS: Record<string, CommodityDefaults> = {
  GOLD: {
    unit: "USD/oz", aisc50: 1560, aisc90: 2075, incentivePrice: 2550, overvaluedBand: 0.30, mos: 0.15, thesis: "monetary",
    asOf: "2026-07",
    source: "S&P Global Mine Cost Outlook Jan-2026 (2025 wtd-avg AISC $1,521); WisdomTree/Bloomberg Aug-2025 median $1,600; 90th & incentive derived (~1.33x / ~1.6x median); new-mine FS decks $2,500+ (Kinross Apr-2026)",
  },
  SILVER: {
    unit: "USD/oz", aisc50: 23, aisc90: 30, incentivePrice: 35, overvaluedBand: 0.30, mos: 0.15, thesis: "monetary",
    asOf: "2026-07",
    source: "Co-product basis: S&P Global Jan-2026 AISC $22.6 (2025) → $23.4 (2026F); World Silver Survey 2026. Incentive notional — ~72% of supply is by-product, so the cost curve barely disciplines price",
  },
  PLATINUM: {
    unit: "USD/oz", aisc50: 1006, aisc90: 1300, incentivePrice: 1450, overvaluedBand: 0.30, mos: 0.15, thesis: "industrial",
    asOf: "2026-07",
    source: "S&P Global Jan-2026 avg AISC $1,006 (2026F); 90th ~$1,300 (<1% of output loss-making at $1,315); incentive derived ~$1,450 (WPIC 2025: prices too weak to fund new SA shafts)",
  },
  PALLADIUM: {
    unit: "USD/oz", aisc50: 1025, aisc90: 1230, incentivePrice: 1400, overvaluedBand: 0.30, mos: 0.15, thesis: "industrial",
    asOf: "2026-07",
    source: "PGM-basket basis (no Pd-only curve published): S&P Global Jan-2026 consensus $1,163; Sibanye-Stillwater Q3-2025 US 2E AISC $1,229 proxies the 90th pct; incentive notional — no greenfield currently justified",
  },
  OIL: {
    unit: "USD/bbl", aisc50: 66, aisc90: 70, incentivePrice: 75, overvaluedBand: 0.35, mos: 0.15, thesis: "energy",
    asOf: "2026-07",
    source: "Dallas Fed Energy Survey Q1-2026: avg new-well breakeven $66 (range $62–70, opex breakeven $43); incentive mid of breakeven→5yr WTI expectation $79",
  },
  BRENT: {
    unit: "USD/bbl", aisc50: 69, aisc90: 74, incentivePrice: 79, overvaluedBand: 0.35, mos: 0.15, thesis: "energy",
    asOf: "2026-07",
    source: "Derived from Dallas Fed WTI Q1-2026 figures + typical $3–4 Brent–WTI spread (no Brent-basis full-cycle survey found)",
  },
  COPPER: {
    unit: "USD/lb", aisc50: 2.70, aisc90: 3.55, incentivePrice: 5.00, overvaluedBand: 0.30, mos: 0.20, thesis: "transition",
    asOf: "2026-07",
    source: "S&P Global Jan-2026 AISC ~269c/lb; 90th derived from 90th-pct C1 ~$3.05 +AISC uplift; greenfield incentive $5.00+ (Goldman Nov-2025 LT $5.22/lb 2025-real; Freeport Apr-2026 brownfield $4.00)",
  },
  IRON_ORE: {
    unit: "USD/t", aisc50: 61, aisc90: 79, incentivePrice: 95, overvaluedBand: 0.35, mos: 0.20, thesis: "industrial",
    asOf: "2026-07",
    source: "62% Fe CFR dmt: S&P Global Jan-2026 wtd-avg AISC $60.8 (2026F); 90th ~$78–80 (China domestic / South Africa); incentive proxy $90–100 (UBS LT $90; Morningstar $100) — Simandou (AISC $58.4) is deflationary",
  },
  LITHIUM: {
    unit: "USD/t LCE", aisc50: 9000, aisc90: 12000, incentivePrice: 17500, overvaluedBand: 0.40, mos: 0.25, thesis: "transition",
    asOf: "2026-07",
    source: "Chemicals-curve basis: S&P Global Jan-2026 — 47% of capacity loss-making at $9,093/t consensus (≈ curve median); 90th derived ~$12k; incentive bracketed $15–20k/t LCE (INN/Fastmarkets Q1-2026 deficit flip)",
  },
  URANIUM: {
    unit: "USD/lb", aisc50: 40, aisc90: 62, incentivePrice: 95, overvaluedBand: 0.35, mos: 0.20, thesis: "energy",
    asOf: "2026-07",
    source: "U3O8: Sprott Uranium Outlook Dec-2025 (producers' incentive $90–100; forwards agree); TradeTech PCI $58.40 Dec-2024 proxies high-cost margin; ANS Apr-2026 LT contract $90 — median AISC weakest figure (no public curve)",
  },
};

const ALIASES: Record<string, string> = { WTI: "OIL", CRUDE: "OIL", XAU: "GOLD", XAG: "SILVER" };

export function normaliseCommodity(ticker: string): string {
  const t = ticker.trim().toUpperCase().replace(/\s+/g, "_");
  return ALIASES[t] ?? t;
}

export type CommodityVerdictZone = "buy" | "watch" | "hold" | "avoid";

export type CommodityValuationResult = {
  kind: "commodity";
  modelVersion: string;
  ticker: string;
  runAt: string;
  ok: boolean;
  currency: string;        // the unit, e.g. "USD/oz"
  price: number;           // live spot in the unit currency (USD)
  codeFairValue: number;   // incentive price
  codeIvLow: number;       // aisc50 (deep-value / mean-reversion floor)
  codeIvHigh: number;      // incentive price (top of the value zone)
  buyBelow: number;        // incentive price (buy at/below long-run fair value)
  sellAbove: number;       // incentive x (1 + overvaluedBand) — oversupply risk
  verdictZone: CommodityVerdictZone;
  spotVsIncentivePct: number | null;
  costCurve: { aisc50: number; aisc90: number; incentivePrice: number; thesis: string; asOf: string; source: string };
  assumptions: Record<string, Tagged>;
  warnings: string[];
};

/** Resolve maintained commodity assumptions + DB overrides (scope = commodity). */
function resolveCommodityAssumptions(key: string): { d: CommodityDefaults; tagged: Record<string, Tagged> } {
  const base = COMMODITY_DEFAULTS[key];
  const d: CommodityDefaults = { ...base };
  const tagged: Record<string, Tagged> = {};
  (Object.keys(base) as (keyof CommodityDefaults)[]).forEach((k) => {
    if (typeof base[k] === "number") tagged[k] = { value: base[k] as number, source: "default" };
  });
  try {
    const db = getDb();
    const rows = db.select().from(valuationAssumptions).all().filter((r) => r.scope === key);
    for (const r of rows) {
      if (r.key in d && typeof d[r.key as keyof CommodityDefaults] === "number") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d as any)[r.key] = r.value;
        tagged[r.key] = { value: r.value, source: "ticker", note: "db override" };
      }
    }
  } catch {
    /* table missing — file defaults only */
  }
  return { d, tagged };
}

export async function runCommodityValuation(ticker: string): Promise<CommodityValuationResult> {
  const key = normaliseCommodity(ticker);
  const warnings: string[] = [];
  const base = COMMODITY_DEFAULTS[key];

  if (!base) {
    return {
      kind: "commodity", modelVersion: COMMODITY_MODEL_VERSION, ticker, runAt: new Date().toISOString(),
      ok: false, currency: "USD", price: 0, codeFairValue: 0, codeIvLow: 0, codeIvHigh: 0,
      buyBelow: 0, sellAbove: 0, verdictZone: "hold", spotVsIncentivePct: null,
      costCurve: { aisc50: 0, aisc90: 0, incentivePrice: 0, thesis: "unknown", asOf: "", source: "" },
      assumptions: {}, warnings: [`No maintained cost-curve assumptions for "${ticker}" — add them to COMMODITY_DEFAULTS or the valuation_assumptions table.`],
    };
  }

  const { d, tagged } = resolveCommodityAssumptions(key);

  // Staleness check: these are maintained analyst estimates, not live data. An
  // aged cost curve silently distorts fair value, so flag it on every run.
  const ageMonths = costCurveAgeMonths(d.asOf);
  if (ageMonths > COST_CURVE_STALE_MONTHS) {
    warnings.push(
      `Cost-curve estimates dated ${d.asOf} (${Number.isFinite(ageMonths) ? `${ageMonths} months old` : "undated"}) — refresh COMMODITY_DEFAULTS (source: ${d.source}).`
    );
  }

  // Live spot (USD, in the commodity's unit).
  let spot = 0;
  try {
    const hist = await getCommodityPriceHistory(key, "1mo", "usd");
    spot = hist.at(-1)?.close ?? 0;
  } catch {
    /* handled below */
  }
  if (!spot) warnings.push("Could not fetch live spot price; valuation context only.");

  const fairValue = d.incentivePrice;
  const buyBelow = d.incentivePrice;
  const sellAbove = d.incentivePrice * (1 + d.overvaluedBand);
  const spotVsIncentivePct = spot && fairValue ? ((spot - fairValue) / fairValue) * 100 : null;

  let verdictZone: CommodityVerdictZone = "hold";
  if (spot) {
    if (spot < fairValue * (1 - d.mos)) verdictZone = "buy";
    else if (spot < fairValue) verdictZone = "watch";
    else if (spot <= sellAbove) verdictZone = "hold";
    else verdictZone = "avoid";
  }
  if (d.thesis === "monetary" && spot > sellAbove) {
    warnings.push("Monetary metal trading well above its cost-curve incentive price — the cost model understates value when monetary/safe-haven demand dominates; reconcile against that thesis.");
  }

  return {
    kind: "commodity",
    modelVersion: COMMODITY_MODEL_VERSION,
    ticker,
    runAt: new Date().toISOString(),
    ok: !!spot,
    currency: d.unit,
    price: spot,
    codeFairValue: fairValue,
    codeIvLow: d.aisc50,
    codeIvHigh: d.incentivePrice,
    buyBelow,
    sellAbove,
    verdictZone,
    spotVsIncentivePct,
    costCurve: { aisc50: d.aisc50, aisc90: d.aisc90, incentivePrice: d.incentivePrice, thesis: d.thesis, asOf: d.asOf, source: d.source },
    assumptions: tagged,
    warnings,
  };
}
