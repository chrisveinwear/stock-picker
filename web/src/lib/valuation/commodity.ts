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
};

/**
 * Maintained cost-curve estimates (UPDATE as the curve shifts — these are not
 * live data). Keyed by the report ticker convention (GOLD, OIL, …). Aliases below.
 */
export const COMMODITY_DEFAULTS: Record<string, CommodityDefaults> = {
  GOLD:      { unit: "USD/oz",  aisc50: 1450, aisc90: 1950, incentivePrice: 2200, overvaluedBand: 0.30, mos: 0.15, thesis: "monetary" },
  SILVER:    { unit: "USD/oz",  aisc50: 14,   aisc90: 20,   incentivePrice: 24,   overvaluedBand: 0.30, mos: 0.15, thesis: "monetary" },
  PLATINUM:  { unit: "USD/oz",  aisc50: 950,  aisc90: 1150, incentivePrice: 1300, overvaluedBand: 0.30, mos: 0.15, thesis: "industrial" },
  PALLADIUM: { unit: "USD/oz",  aisc50: 1000, aisc90: 1350, incentivePrice: 1400, overvaluedBand: 0.30, mos: 0.15, thesis: "industrial" },
  OIL:       { unit: "USD/bbl", aisc50: 40,   aisc90: 55,   incentivePrice: 65,   overvaluedBand: 0.35, mos: 0.15, thesis: "energy" },
  BRENT:     { unit: "USD/bbl", aisc50: 42,   aisc90: 58,   incentivePrice: 70,   overvaluedBand: 0.35, mos: 0.15, thesis: "energy" },
  COPPER:    { unit: "USD/lb",  aisc50: 2.4,  aisc90: 3.2,  incentivePrice: 4.5,  overvaluedBand: 0.30, mos: 0.20, thesis: "transition" },
  IRON_ORE:  { unit: "USD/t",   aisc50: 40,   aisc90: 70,   incentivePrice: 90,   overvaluedBand: 0.35, mos: 0.20, thesis: "industrial" },
  LITHIUM:   { unit: "USD/t",   aisc50: 6000, aisc90: 10000,incentivePrice: 15000,overvaluedBand: 0.40, mos: 0.25, thesis: "transition" },
  URANIUM:   { unit: "USD/lb",  aisc50: 35,   aisc90: 55,   incentivePrice: 75,   overvaluedBand: 0.35, mos: 0.20, thesis: "energy" },
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
  costCurve: { aisc50: number; aisc90: number; incentivePrice: number; thesis: string };
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
      costCurve: { aisc50: 0, aisc90: 0, incentivePrice: 0, thesis: "unknown" },
      assumptions: {}, warnings: [`No maintained cost-curve assumptions for "${ticker}" — add them to COMMODITY_DEFAULTS or the valuation_assumptions table.`],
    };
  }

  const { d, tagged } = resolveCommodityAssumptions(key);

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
    costCurve: { aisc50: d.aisc50, aisc90: d.aisc90, incentivePrice: d.incentivePrice, thesis: d.thesis },
    assumptions: tagged,
    warnings,
  };
}
