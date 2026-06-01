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
  const [gold, silver, fx] = await Promise.all([
    getRawQuote("GC=F"),
    getRawQuote("SI=F"),
    getRawQuote("AUDUSD=X"),
  ]);

  const audUsd    = fx.price;
  const goldUsd   = gold.price;
  const silverUsd = silver.price;
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
