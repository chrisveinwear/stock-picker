/**
 * Valuation inputs — the anti-hallucination core. Pulls verified data (live
 * fundamentals + multi-year statements), normalises a base owner-earnings figure
 * that does NOT anchor on a trough year, converts financial-currency figures into
 * the price currency via a fetched FX rate (never guessed), and emits validation
 * warnings instead of silently fabricating. Every value carries provenance.
 *
 * Input hygiene rules (dcf-v2):
 *   - Beta is clamped into [betaFloor, betaCap]: Yahoo betas for commodity/gold
 *     names can be negative, which would produce a nonsense CAPM rate.
 *   - Yahoo EPS fields have no reliable currency convention for split-currency
 *     listings (e.g. USD financials / AUD price), so every EPS figure is reconciled
 *     against price ÷ P/E and FX-converted or replaced when it disagrees.
 *   - The historical owner-earnings candidate requires capex to be present for a
 *     year to count (a missing capex silently inflates owner earnings); a missing
 *     D&A only understates, so it is tolerated.
 */
import {
  getEquityFundamentals,
  getFinancialTimeSeries,
  getFxRate,
  type FinancialYear,
} from "@/lib/yahoo-finance";
import { DEFAULTS } from "./assumptions";

export type Provenanced = { value: number | string | null; source: string; asOf?: string };

export type ValuationInputs = {
  ticker: string;
  sector: string | null;
  priceCurrency: string;
  financialCurrency: string;
  fxFinToPrice: number; // multiply a financial-currency figure to get price currency
  price: number;
  sharesOutstanding: number;
  beta: number; // sanitised (clamped) — raw value recorded in provenance
  taxRate: number;      // informational (equity DCF does not blend a WACC)
  costOfDebt: number;   // informational
  netDebt: number; // price currency — context/leverage check, NOT subtracted from the equity DCF
  baseOwnerEarnings: number; // price currency, normalised
  baseBasis: string; // how the base was derived (candidates + chosen)
  revenueTTM: number | null; // price currency
  bookValuePerShare: number | null; // price currency
  epsTrailing: number | null; // price currency, reconciled vs price/PE
  epsForward: number | null;  // price currency, reconciled vs price/PE
  analystTargetMean: number | null; // price currency
  returnOnEquityPct: number | null;
  profitMarginsPct: number | null;
  marketCap: number | null; // price currency
  history: FinancialYear[];
  provenance: Record<string, Provenanced>;
  warnings: string[];
  ok: boolean; // false if we lack the minimum to value
};

const median = (xs: number[]): number | null => {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Reconcile a Yahoo EPS figure into the price currency using price ÷ P/E as the
 * arbiter. Yahoo's EPS currency is inconsistent for listings whose financials are
 * reported in another currency, so: accept the EPS if it roughly matches the
 * P/E-implied EPS; FX-convert it if the converted figure matches instead; fall
 * back to the P/E-implied EPS when neither does.
 */
export function reconcileEps(p: {
  eps: number | null;
  price: number | null;
  pe: number | null;
  fxFinToPrice: number;
}): { value: number | null; note: string } {
  const { eps, price, pe, fxFinToPrice } = p;
  if (eps == null) return { value: null, note: "unavailable" };
  const implied = price != null && price > 0 && pe != null && pe > 0 ? price / pe : null;
  if (implied == null) return { value: eps, note: "unverified (no P/E to cross-check)" };
  const rel = (x: number) => Math.abs(x - implied) / implied;
  if (rel(eps) <= 0.25) return { value: eps, note: "verified vs price/PE" };
  const converted = eps * fxFinToPrice;
  if (fxFinToPrice !== 1 && rel(converted) <= 0.25) {
    return { value: converted, note: `FX-converted (raw ${eps} was financial-currency)` };
  }
  return { value: implied, note: `replaced by price/PE-implied EPS (raw ${eps} inconsistent)` };
}

export async function getValuationInputs(ticker: string): Promise<ValuationInputs> {
  const warnings: string[] = [];
  const provenance: Record<string, Provenanced> = {};

  const [f, history] = await Promise.all([
    getEquityFundamentals(ticker),
    getFinancialTimeSeries(ticker).catch(() => [] as FinancialYear[]),
  ]);

  const priceCurrency = f?.priceCurrency ?? "AUD";
  const financialCurrency = f?.financialCurrency ?? priceCurrency;

  // FX: convert financial-currency statement figures into the price currency.
  let fxFinToPrice = 1;
  if (financialCurrency !== priceCurrency) {
    const fx = await getFxRate(financialCurrency, priceCurrency);
    if (fx && fx > 0) {
      fxFinToPrice = fx;
      provenance.fxFinToPrice = { value: fx, source: `yahoo ${financialCurrency}${priceCurrency}=X` };
    } else {
      warnings.push(`Could not fetch ${financialCurrency}->${priceCurrency} FX; financial figures left unconverted.`);
    }
  }
  const toPrice = (v: number | null | undefined) => (v == null ? null : v * fxFinToPrice);

  const price = f?.price ?? null;
  const shares = f?.sharesOutstanding ?? history.at(-1)?.ordinarySharesNumber ?? null;

  // Beta sanitisation: negative/near-zero Yahoo betas (gold miners, defensives)
  // would give a CAPM rate below the risk-free rate — clamp into a sane band.
  const rawBeta = f?.beta ?? null;
  let beta = rawBeta ?? 1.0;
  if (rawBeta == null) warnings.push("Beta unavailable; defaulted to 1.0.");
  if (beta < DEFAULTS.betaFloor || beta > DEFAULTS.betaCap) {
    const clamped = clamp(beta, DEFAULTS.betaFloor, DEFAULTS.betaCap);
    warnings.push(`Beta ${beta.toFixed(2)} outside [${DEFAULTS.betaFloor}, ${DEFAULTS.betaCap}] — clamped to ${clamped.toFixed(2)}.`);
    beta = clamped;
  }
  provenance.price = { value: price, source: "yahoo quote" };
  provenance.sharesOutstanding = { value: shares, source: f?.sharesOutstanding != null ? "yahoo quote" : "fundamentalsTimeSeries" };
  provenance.beta = {
    value: beta,
    source: rawBeta == null ? "default" : rawBeta === beta ? "yahoo" : `yahoo ${rawBeta} clamped`,
  };

  // Effective tax rate (median of history), clamped; informational for dcf-v2.
  const taxRates = history
    .filter((h) => h.pretaxIncome != null && h.pretaxIncome !== 0 && h.taxProvision != null)
    .map((h) => (h.taxProvision as number) / (h.pretaxIncome as number));
  const taxRate = taxRates.length ? clamp(median(taxRates)!, 0.1, 0.32) : DEFAULTS.taxRate;
  provenance.taxRate = { value: taxRate, source: taxRates.length ? "history median" : "default 0.30" };

  // Cost of debt = interest / total debt (median), clamped; informational.
  const cods = history
    .filter((h) => h.interestExpense != null && h.totalDebt != null && (h.totalDebt as number) > 0)
    .map((h) => (h.interestExpense as number) / (h.totalDebt as number));
  const costOfDebt = cods.length ? clamp(median(cods)!, 0.02, 0.10) : DEFAULTS.costOfDebtFallback;
  provenance.costOfDebt = { value: costOfDebt, source: cods.length ? "history median" : "default 0.06" };

  // Net debt (latest), price currency. Context + leverage check only — the
  // equity DCF discounts a post-interest cash flow, so net debt is NOT deducted.
  const latest = history.at(-1);
  const netDebtFin =
    latest?.totalDebt != null
      ? (latest.totalDebt) - (latest.cashAndCashEquivalents ?? 0)
      : f?.totalDebt != null
      ? f.totalDebt - (f.totalCash ?? 0)
      : 0;
  const netDebt = (toPrice(netDebtFin) ?? 0);
  provenance.netDebt = { value: netDebt, source: latest?.totalDebt != null ? "FTS latest" : "fundamentals" };

  const revenueTTM = toPrice(f?.totalRevenue ?? latest?.totalRevenue ?? null);

  // EPS reconciliation into the price currency (Yahoo's EPS currency is not a
  // reliable invariant for split-currency listings).
  const epsT = reconcileEps({ eps: f?.epsTrailing ?? null, price, pe: f?.trailingPE ?? null, fxFinToPrice });
  const epsF = reconcileEps({ eps: f?.epsForward ?? null, price, pe: f?.forwardPE ?? null, fxFinToPrice });
  provenance.epsTrailing = { value: epsT.value, source: `yahoo, ${epsT.note}` };
  provenance.epsForward = { value: epsF.value, source: `yahoo, ${epsF.note}` };
  if (epsT.note.startsWith("replaced") || epsF.note.startsWith("replaced")) {
    warnings.push("A Yahoo EPS figure disagreed with price÷P/E in both raw and FX-converted form — the P/E-implied EPS was used instead.");
  }

  // ── Normalised base owner earnings (avoid trough): median of candidates ──
  // All candidates are EQUITY-level (post-interest) cash-flow proxies.
  // Candidate 1: forward net income (reconciled forward EPS x shares) — captures
  //   current (post-acquisition) scale and the analyst view.
  const forwardNI = epsF.value != null && shares ? epsF.value * shares : null;
  // Candidate 2: median historical net margin x current revenue.
  const margins = history
    .filter((h) => h.netIncome != null && h.totalRevenue != null && (h.totalRevenue as number) > 0)
    .map((h) => (h.netIncome as number) / (h.totalRevenue as number));
  const medMargin = median(margins);
  const marginNorm = medMargin != null && revenueTTM != null ? medMargin * revenueTTM : null;
  // Candidate 3: median historical owner earnings (NI + D&A + capex[neg]).
  // Capex must be PRESENT — a missing capex silently inflates owner earnings.
  const oeYears = history.filter((h) => h.netIncome != null && h.capitalExpenditure != null);
  const histOE = oeYears.map(
    (h) => (h.netIncome as number) + (h.depreciationAndAmortization ?? 0) + (h.capitalExpenditure as number)
  );
  const skippedOeYears = history.filter((h) => h.netIncome != null).length - oeYears.length;
  if (skippedOeYears > 0) {
    warnings.push(`${skippedOeYears} year(s) excluded from the owner-earnings candidate (capex missing).`);
  }
  const histMedianOE = toPrice(median(histOE) ?? null);
  // Candidate 4: median historical free cash flow (OCF − capex — captures
  //   working-capital movements that NI + D&A − capex misses).
  const histFCF = history.filter((h) => h.freeCashFlow != null).map((h) => h.freeCashFlow as number);
  const histMedianFCF = toPrice(median(histFCF) ?? null);

  const candidates: { label: string; v: number | null }[] = [
    { label: "forwardNI", v: forwardNI },
    { label: "marginNorm", v: marginNorm },
    { label: "histMedianOE", v: histMedianOE },
    { label: "histMedianFCF", v: histMedianFCF },
  ];
  const usable = candidates.filter((c) => c.v != null && (c.v as number) > 0) as { label: string; v: number }[];
  const baseOwnerEarnings = usable.length ? median(usable.map((c) => c.v))! : 0;
  const baseBasis =
    usable.map((c) => `${c.label}=${Math.round(c.v).toLocaleString()}`).join(" · ") +
    ` -> median ${Math.round(baseOwnerEarnings).toLocaleString()} ${priceCurrency}`;
  provenance.baseOwnerEarnings = { value: baseOwnerEarnings, source: `median(${usable.map((c) => c.label).join(",")})` };

  const bookValuePerShare =
    latest?.stockholdersEquity != null && shares
      ? (toPrice(latest.stockholdersEquity)! / shares)
      : null;

  // ── Validation ──
  if (!shares || shares <= 0) warnings.push("Shares outstanding missing — cannot compute per-share value.");
  if (!price || price <= 0) warnings.push("Current price missing.");
  if (!usable.length) warnings.push("No usable earnings base (forward/margin/history all unavailable).");
  if (!history.length) warnings.push("No multi-year financial statements returned (FTS empty).");
  if (f?.marketCap && price && shares) {
    const implied = price * shares;
    const diff = Math.abs(implied - f.marketCap) / f.marketCap;
    if (diff > 0.05) warnings.push(`Market-cap inconsistency: price*shares vs reported marketCap differ ${(diff * 100).toFixed(0)}%.`);
  }
  if (baseOwnerEarnings > 0 && revenueTTM && baseOwnerEarnings > revenueTTM) {
    warnings.push("Normalised earnings exceed revenue — input anomaly.");
  }
  if (f?.marketCap && f.marketCap > 0 && netDebt > 0.6 * f.marketCap) {
    warnings.push(
      `High leverage: net debt is ${((netDebt / f.marketCap) * 100).toFixed(0)}% of market cap — the CAPM discount rate relies on beta capturing this; treat the IV with extra margin of safety.`
    );
  }

  const ok = !!(shares && shares > 0 && price && price > 0 && baseOwnerEarnings > 0);

  return {
    ticker,
    sector: f?.sector ?? null,
    priceCurrency,
    financialCurrency,
    fxFinToPrice,
    price: price ?? 0,
    sharesOutstanding: shares ?? 0,
    beta,
    taxRate,
    costOfDebt,
    netDebt,
    baseOwnerEarnings,
    baseBasis,
    revenueTTM,
    bookValuePerShare,
    epsTrailing: epsT.value,
    epsForward: epsF.value,
    analystTargetMean: f?.targetMeanPrice ?? null,
    returnOnEquityPct: f?.returnOnEquityPct ?? null,
    profitMarginsPct: f?.profitMarginsPct ?? null,
    marketCap: f?.marketCap ?? null,
    history,
    provenance,
    warnings,
    ok,
  };
}
