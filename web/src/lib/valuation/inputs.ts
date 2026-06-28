/**
 * Valuation inputs — the anti-hallucination core. Pulls verified data (live
 * fundamentals + multi-year statements), normalises a base owner-earnings figure
 * that does NOT anchor on a trough year, converts financial-currency figures into
 * the price currency via a fetched FX rate (never guessed), and emits validation
 * warnings instead of silently fabricating. Every value carries provenance.
 */
import {
  getEquityFundamentals,
  getFinancialTimeSeries,
  getFxRate,
  type FinancialYear,
} from "@/lib/yahoo-finance";

export type Provenanced = { value: number | string | null; source: string; asOf?: string };

export type ValuationInputs = {
  ticker: string;
  priceCurrency: string;
  financialCurrency: string;
  fxFinToPrice: number; // multiply a financial-currency figure to get price currency
  price: number;
  sharesOutstanding: number;
  beta: number;
  taxRate: number;
  costOfDebt: number;
  netDebt: number; // price currency
  baseOwnerEarnings: number; // price currency, normalised
  baseBasis: string; // how the base was derived (candidates + chosen)
  revenueTTM: number | null; // price currency
  bookValuePerShare: number | null; // price currency
  epsTrailing: number | null;
  epsForward: number | null;
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
  const beta = f?.beta ?? 1.0;
  if (f?.beta == null) warnings.push("Beta unavailable; defaulted to 1.0.");
  provenance.price = { value: price, source: "yahoo quote" };
  provenance.sharesOutstanding = { value: shares, source: f?.sharesOutstanding != null ? "yahoo quote" : "fundamentalsTimeSeries" };
  provenance.beta = { value: beta, source: f?.beta != null ? "yahoo" : "default" };

  // Effective tax rate (median of history), clamped; fallback handled by assumptions.
  const taxRates = history
    .filter((h) => h.pretaxIncome != null && h.pretaxIncome !== 0 && h.taxProvision != null)
    .map((h) => (h.taxProvision as number) / (h.pretaxIncome as number));
  const taxRate = taxRates.length ? clamp(median(taxRates)!, 0.1, 0.32) : 0.30;
  provenance.taxRate = { value: taxRate, source: taxRates.length ? "history median" : "default 0.30" };

  // Cost of debt = interest / total debt (median), clamped.
  const cods = history
    .filter((h) => h.interestExpense != null && h.totalDebt != null && (h.totalDebt as number) > 0)
    .map((h) => (h.interestExpense as number) / (h.totalDebt as number));
  const costOfDebt = cods.length ? clamp(median(cods)!, 0.02, 0.10) : 0.06;
  provenance.costOfDebt = { value: costOfDebt, source: cods.length ? "history median" : "default 0.06" };

  // Net debt (latest), price currency.
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

  // ── Normalised base owner earnings (avoid trough): median of candidates ──
  // Candidate 1: forward net income (analyst forward EPS x shares) — captures
  //   current (post-acquisition) scale.
  const forwardNI = f?.epsForward != null && shares ? f.epsForward * shares : null;
  // Candidate 2: median historical net margin x current revenue.
  const margins = history
    .filter((h) => h.netIncome != null && h.totalRevenue != null && (h.totalRevenue as number) > 0)
    .map((h) => (h.netIncome as number) / (h.totalRevenue as number));
  const medMargin = median(margins);
  const marginNorm = medMargin != null && revenueTTM != null ? medMargin * revenueTTM : null;
  // Candidate 3: median historical owner earnings (NI + D&A + capex[neg]).
  const histOE = history
    .filter((h) => h.netIncome != null)
    .map((h) => (h.netIncome as number) + (h.depreciationAndAmortization ?? 0) + (h.capitalExpenditure ?? 0));
  const histMedianOE = toPrice(median(histOE) ?? null);

  const candidates: { label: string; v: number | null }[] = [
    { label: "forwardNI", v: forwardNI },
    { label: "marginNorm", v: marginNorm },
    { label: "histMedianOE", v: histMedianOE },
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

  const ok = !!(shares && shares > 0 && price && price > 0 && baseOwnerEarnings > 0);

  return {
    ticker,
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
    epsTrailing: f?.epsTrailing ?? null,
    epsForward: f?.epsForward ?? null,
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
