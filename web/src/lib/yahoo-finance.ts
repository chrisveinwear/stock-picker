/**
 * Yahoo Finance price fetching for ASX stocks.
 * Uses .AX suffix (e.g. CBA.AX). Server-side only — Yahoo Finance has CORS restrictions.
 *
 * Known issue: Yahoo Finance historical data for some .AX stocks has inaccurate
 * pre-adjustment prices. Use current price quotes for portfolio calculations;
 * treat historical charts as indicative only.
 */
import YahooFinance from "yahoo-finance2";
const yahooFinance = new YahooFinance();
import { getDb } from "@/db";
import { priceCache } from "@/db/schema";
import { eq } from "drizzle-orm";

const CACHE_TTL_MINUTES = 15;

export type StockQuote = {
  ticker: string;
  lastPrice: number;
  previousClose: number | null;
  changePercent: number | null;
  currency: string;
  marketCap: number | null;
  peRatio: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fetchedAt: string;
  fromCache: boolean;
};

function normaliseTicker(ticker: string): string {
  // Accept "CBA" or "CBA.AX" — always return "CBA.AX"
  if (ticker.includes(".")) return ticker.toUpperCase();
  return `${ticker.toUpperCase()}.AX`;
}

function isCacheStale(fetchedAt: string): boolean {
  const age = Date.now() - new Date(fetchedAt).getTime();
  return age > CACHE_TTL_MINUTES * 60 * 1000;
}

export async function getQuote(ticker: string): Promise<StockQuote> {
  const normTicker = normaliseTicker(ticker);
  const db = getDb();

  // Check cache first
  const cached = db.select().from(priceCache).where(eq(priceCache.ticker, normTicker)).get();
  if (cached && cached.fetchedAt && !isCacheStale(cached.fetchedAt)) {
    return {
      ticker: normTicker,
      lastPrice: cached.lastPrice ?? 0,
      previousClose: cached.previousClose,
      changePercent: cached.lastPrice && cached.previousClose
        ? ((cached.lastPrice - cached.previousClose) / cached.previousClose) * 100
        : null,
      currency: cached.currency ?? "AUD",
      marketCap: cached.marketCap,
      peRatio: cached.peRatio,
      fiftyTwoWeekHigh: cached.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: cached.fiftyTwoWeekLow,
      fetchedAt: cached.fetchedAt,
      fromCache: true,
    };
  }

  // Fetch fresh data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const quote: any = await yahooFinance.quote(normTicker);
  const now = new Date().toISOString();

  const row = {
    ticker: normTicker,
    lastPrice: quote.regularMarketPrice ?? null,
    previousClose: quote.regularMarketPreviousClose ?? null,
    currency: quote.currency ?? "AUD",
    marketCap: quote.marketCap ?? null,
    peRatio: quote.trailingPE ?? null,
    fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
    fiftyTwoWeekLow: quote.fiftyTwoWeekLow ?? null,
    fetchedAt: now,
  };

  // Upsert cache
  db.insert(priceCache).values(row).onConflictDoUpdate({
    target: priceCache.ticker,
    set: row,
  }).run();

  return {
    ...row,
    lastPrice: row.lastPrice ?? 0,
    changePercent: row.lastPrice && row.previousClose
      ? ((row.lastPrice - row.previousClose) / row.previousClose) * 100
      : null,
    fromCache: false,
  };
}

export async function getQuotes(tickers: string[]): Promise<StockQuote[]> {
  const results = await Promise.allSettled(tickers.map(getQuote));
  return results
    .filter((r): r is PromiseFulfilledResult<StockQuote> => r.status === "fulfilled")
    .map((r) => r.value);
}

// Authoritative fundamentals for a report — richer than the cached StockQuote,
// including share count, financials and the analyst consensus target (a built-in
// sanity check against the model's own intrinsic value).
export type EquityFundamentals = {
  ticker: string;
  priceCurrency: string | null;
  financialCurrency: string | null;
  price: number | null;
  previousClose: number | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  epsTrailing: number | null;
  epsForward: number | null;
  dividendYieldPct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  beta: number | null;
  totalRevenue: number | null;
  ebitda: number | null;
  grossMarginsPct: number | null;
  operatingMarginsPct: number | null;
  profitMarginsPct: number | null;
  returnOnEquityPct: number | null;
  totalDebt: number | null;
  totalCash: number | null;
  freeCashflow: number | null;
  debtToEquity: number | null;
  targetMeanPrice: number | null;
  targetLowPrice: number | null;
  targetHighPrice: number | null;
  numberOfAnalystOpinions: number | null;
  recommendationKey: string | null;
};

// One annual fiscal-year row of statement data needed for a DCF. Sourced from
// fundamentalsTimeSeries (the legacy *StatementHistory modules are deprecated).
export type FinancialYear = {
  date: string;
  totalRevenue: number | null;
  operatingIncome: number | null;
  ebit: number | null;
  ebitda: number | null;
  depreciationAndAmortization: number | null;
  interestExpense: number | null;
  taxProvision: number | null;
  pretaxIncome: number | null;
  netIncome: number | null;
  operatingCashFlow: number | null;
  capitalExpenditure: number | null; // negative as reported
  freeCashFlow: number | null;
  totalDebt: number | null;
  cashAndCashEquivalents: number | null;
  stockholdersEquity: number | null;
  ordinarySharesNumber: number | null;
};

export async function getFinancialTimeSeries(
  ticker: string,
  years = 6
): Promise<FinancialYear[]> {
  const normTicker = normaliseTicker(ticker);
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - years);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any = await yahooFinance.fundamentalsTimeSeries(normTicker, {
    period1,
    type: "annual",
    module: "all",
  });
  const arr = Array.isArray(rows) ? rows : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return arr.map((r: any) => ({
    date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date ?? ""),
    totalRevenue: r.totalRevenue ?? null,
    operatingIncome: r.operatingIncome ?? null,
    ebit: r.EBIT ?? null,
    ebitda: r.EBITDA ?? r.normalizedEBITDA ?? null,
    depreciationAndAmortization: r.depreciationAndAmortization ?? r.reconciledDepreciation ?? null,
    interestExpense: r.interestExpense ?? null,
    taxProvision: r.taxProvision ?? null,
    pretaxIncome: r.pretaxIncome ?? null,
    netIncome: r.netIncome ?? null,
    operatingCashFlow: r.operatingCashFlow ?? null,
    capitalExpenditure: r.capitalExpenditure ?? null,
    freeCashFlow: r.freeCashFlow ?? null,
    totalDebt: r.totalDebt ?? null,
    cashAndCashEquivalents: r.cashAndCashEquivalents ?? null,
    stockholdersEquity: r.stockholdersEquity ?? r.commonStockEquity ?? null,
    ordinarySharesNumber: r.ordinarySharesNumber ?? null,
  }));
}

/** Spot FX rate as price of 1 unit of `base` in `quote` (e.g. AUDUSD ~0.65). */
export async function getFxRate(base: string, quote: string): Promise<number | null> {
  if (base === quote) return 1;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = await yahooFinance.quote(`${base}${quote}=X`);
    return q?.regularMarketPrice ?? null;
  } catch {
    return null;
  }
}

export async function getEquityFundamentals(
  ticker: string
): Promise<EquityFundamentals | null> {
  const normTicker = normaliseTicker(ticker);
  try {
    const [q, s] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      yahooFinance.quote(normTicker) as Promise<any>,
      yahooFinance
        .quoteSummary(normTicker, {
          modules: ["financialData", "defaultKeyStatistics", "summaryDetail"],
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .catch(() => null) as Promise<any>,
    ]);
    if (!q) return null;
    const fd = s?.financialData ?? {};
    const ks = s?.defaultKeyStatistics ?? {};
    const sd = s?.summaryDetail ?? {};
    const pct = (v: unknown) => (typeof v === "number" ? v * 100 : null);

    return {
      ticker: normTicker,
      priceCurrency: q.currency ?? null,
      financialCurrency: q.financialCurrency ?? null,
      price: q.regularMarketPrice ?? fd.currentPrice ?? null,
      previousClose: q.regularMarketPreviousClose ?? null,
      marketCap: q.marketCap ?? null,
      sharesOutstanding: q.sharesOutstanding ?? ks.sharesOutstanding ?? null,
      trailingPE: q.trailingPE ?? sd.trailingPE ?? null,
      forwardPE: q.forwardPE ?? sd.forwardPE ?? null,
      priceToBook: q.priceToBook ?? ks.priceToBook ?? null,
      epsTrailing: q.epsTrailingTwelveMonths ?? ks.trailingEps ?? null,
      epsForward: q.epsForward ?? ks.forwardEps ?? null,
      dividendYieldPct: q.dividendYield ?? pct(sd.dividendYield),
      fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? sd.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? sd.fiftyTwoWeekLow ?? null,
      beta: sd.beta ?? null,
      totalRevenue: fd.totalRevenue ?? null,
      ebitda: fd.ebitda ?? null,
      grossMarginsPct: pct(fd.grossMargins),
      operatingMarginsPct: pct(fd.operatingMargins),
      profitMarginsPct: pct(fd.profitMargins ?? ks.profitMargins),
      returnOnEquityPct: pct(fd.returnOnEquity),
      totalDebt: fd.totalDebt ?? null,
      totalCash: fd.totalCash ?? null,
      freeCashflow: fd.freeCashflow ?? null,
      debtToEquity: fd.debtToEquity ?? null,
      targetMeanPrice: fd.targetMeanPrice ?? null,
      targetLowPrice: fd.targetLowPrice ?? null,
      targetHighPrice: fd.targetHighPrice ?? null,
      numberOfAnalystOpinions: fd.numberOfAnalystOpinions ?? null,
      recommendationKey: fd.recommendationKey ?? null,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Metals spot prices — gold, silver in AUD via Yahoo Finance futures + forex
// ---------------------------------------------------------------------------

export type MetalPrices = {
  goldUsd: number;
  goldAud: number;
  silverUsd: number;
  silverAud: number;
  audUsd: number;
  goldSilverRatio: number;
  goldChangePercent: number | null;
  silverChangePercent: number | null;
  fetchedAt: string;
  fromCache: boolean;
};

const METAL_CACHE_KEY = "METAL_PRICES";

/** Fetch a Yahoo Finance quote without any .AX normalisation — for futures/forex tickers */
async function getRawQuote(ticker: string): Promise<{ price: number; prevClose: number | null }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q: any = await yahooFinance.quote(ticker);
  return {
    price: q.regularMarketPrice ?? 0,
    prevClose: q.regularMarketPreviousClose ?? null,
  };
}

export async function getMetalPrices(): Promise<MetalPrices> {
  const db = getDb();
  const now = new Date().toISOString();

  // Check cache — stored as a single JSON blob in the lastPrice field won't work,
  // so we cache each synthetic ticker separately
  const goldCache  = db.select().from(priceCache).where(eq(priceCache.ticker, "METAL_GOLD")).get();
  const audCache   = db.select().from(priceCache).where(eq(priceCache.ticker, "METAL_AUDUSD")).get();

  if (goldCache?.fetchedAt && !isCacheStale(goldCache.fetchedAt) && audCache?.fetchedAt && !isCacheStale(audCache.fetchedAt)) {
    const silverCache = db.select().from(priceCache).where(eq(priceCache.ticker, "METAL_SILVER")).get();
    const goldUsd   = goldCache.lastPrice ?? 0;
    const silverUsd = silverCache?.lastPrice ?? 0;
    const audUsd    = audCache.lastPrice ?? 0;
    // Always compute AUD prices via USD/AUDUSD — never expose raw USD values as AUD
    const goldAud   = audUsd > 0 ? goldUsd / audUsd : 0;
    const silverAud = audUsd > 0 ? silverUsd / audUsd : 0;
    return {
      goldUsd, goldAud, silverUsd, silverAud, audUsd,
      goldSilverRatio: silverUsd > 0 ? goldUsd / silverUsd : 0,
      goldChangePercent: goldCache.lastPrice && goldCache.previousClose
        ? ((goldCache.lastPrice - goldCache.previousClose) / goldCache.previousClose) * 100 : null,
      silverChangePercent: silverCache?.lastPrice && silverCache?.previousClose
        ? ((silverCache.lastPrice - silverCache.previousClose) / silverCache.previousClose) * 100 : null,
      fetchedAt: goldCache.fetchedAt,
      fromCache: true,
    };
  }

  // Fetch live — GC=F (gold futures USD/oz), SI=F (silver futures USD/oz), AUDUSD=X
  // AUD prices are always derived as: priceUsd / audUsd — never exposed as raw USD
  const [gold, silver, fx] = await Promise.all([
    getRawQuote("GC=F"),
    getRawQuote("SI=F"),
    getRawQuote("AUDUSD=X"),
  ]);

  const audUsd    = fx.price;
  const goldUsd   = gold.price;
  const silverUsd = silver.price;
  // Guard against missing FX rate — fall back to 0 rather than showing USD price as AUD
  const goldAud   = audUsd > 0 ? goldUsd / audUsd : 0;
  const silverAud = audUsd > 0 ? silverUsd / audUsd : 0;

  // Cache each value
  const upsert = (ticker: string, price: number, prevClose: number | null) =>
    db.insert(priceCache).values({ ticker, lastPrice: price, previousClose: prevClose, currency: "USD", fetchedAt: now })
      .onConflictDoUpdate({ target: priceCache.ticker, set: { lastPrice: price, previousClose: prevClose, fetchedAt: now } })
      .run();

  upsert("METAL_GOLD",   goldUsd,   gold.prevClose);
  upsert("METAL_SILVER", silverUsd, silver.prevClose);
  upsert("METAL_AUDUSD", audUsd,    fx.prevClose);

  return {
    goldUsd, goldAud, silverUsd, silverAud, audUsd,
    goldSilverRatio: silverUsd > 0 ? goldUsd / silverUsd : 0,
    goldChangePercent: gold.prevClose ? ((goldUsd - gold.prevClose) / gold.prevClose) * 100 : null,
    silverChangePercent: silver.prevClose ? ((silverUsd - silver.prevClose) / silver.prevClose) * 100 : null,
    fetchedAt: now,
    fromCache: false,
  };
}

// ---------------------------------------------------------------------------

export type PriceHistory = {
  date: string;
  close: number;
  volume: number;
};

export async function getPriceHistory(
  ticker: string,
  period: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" = "1y"
): Promise<PriceHistory[]> {
  const normTicker = normaliseTicker(ticker);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await yahooFinance.chart(normTicker, {
    period1: getPeriodStart(period),
    interval: period === "1mo" ? "1d" : period === "3mo" ? "1d" : "1wk",
  });

  return (result.quotes ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((q: any) => q.close != null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((q: any) => ({
      date: new Date(q.date).toISOString().split("T")[0],
      close: q.close!,
      volume: q.volume ?? 0,
    }));
}

function getPeriodStart(period: string): Date {
  const now = new Date();
  const map: Record<string, number> = {
    "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825,
  };
  now.setDate(now.getDate() - (map[period] ?? 365));
  return now;
}

// Physical commodities → Yahoo Finance futures/spot symbols (all priced in USD).
const COMMODITY_SYMBOLS: Record<string, string> = {
  GOLD: "GC=F",      // USD/oz
  SILVER: "SI=F",    // USD/oz
  PLATINUM: "PL=F",  // USD/oz
  PALLADIUM: "PA=F", // USD/oz
  OIL: "CL=F",       // WTI crude, USD/bbl
  WTI: "CL=F",
  BRENT: "BZ=F",     // Brent crude, USD/bbl
  COPPER: "HG=F",    // USD/lb
};

/** Raw weekly close series for a Yahoo symbol that must NOT be ".AX"-normalised. */
async function getRawHistory(symbol: string, period: string): Promise<PriceHistory[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await yahooFinance.chart(symbol, {
    period1: getPeriodStart(period),
    interval: period === "1mo" || period === "3mo" ? "1d" : "1wk",
  });
  return (result.quotes ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((q: any) => q.close != null)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((q: any) => ({
      date: new Date(q.date).toISOString().split("T")[0],
      close: q.close as number,
      volume: q.volume ?? 0,
    }));
}

/**
 * Historical spot for a physical commodity. Yahoo quotes these in USD; when
 * `currency` is "aud" the series is converted per-date using AUDUSD history so
 * it matches AUD-denominated reports (e.g. gold shown in AUD/oz). Returns [] for
 * unknown commodities so callers can render without the price line.
 */
export async function getCommodityPriceHistory(
  commodity: string,
  period: "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" = "2y",
  currency: "usd" | "aud" = "usd"
): Promise<PriceHistory[]> {
  const symbol = COMMODITY_SYMBOLS[commodity.trim().toUpperCase()];
  if (!symbol) return [];

  const usdSeries = await getRawHistory(symbol, period);
  if (currency === "usd" || usdSeries.length === 0) return usdSeries;

  // Convert USD → AUD using AUDUSD=X history, matching each point to the latest
  // available FX rate on or before its date.
  const fx = await getRawHistory("AUDUSD=X", period);
  if (!fx.length) return usdSeries; // no FX — better to show USD than nothing
  const fxAsc = [...fx].sort((a, b) => a.date.localeCompare(b.date));

  let i = 0;
  let lastRate = fxAsc[0].close;
  return usdSeries.map((p) => {
    while (i < fxAsc.length && fxAsc[i].date <= p.date) {
      lastRate = fxAsc[i].close;
      i++;
    }
    return { date: p.date, close: lastRate > 0 ? p.close / lastRate : p.close, volume: p.volume };
  });
}
