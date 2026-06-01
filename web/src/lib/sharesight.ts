/**
 * Sharesight API client with persistent token storage.
 * Tokens are persisted to web/data/sharesight-tokens.json so they survive server restarts.
 */

import fs from "fs";
import path from "path";

const TOKEN_URL = "https://api.sharesight.com/oauth2/token";
const API_BASE = "https://api.sharesight.com/api/v2";
const TOKEN_FILE = path.join(process.cwd(), "data", "sharesight-tokens.json");

interface TokenStore {
  access_token: string;
  refresh_token: string;
  expires_at: number; // unix seconds
}

let memCache: TokenStore | null = null;

function loadTokens(): TokenStore | null {
  if (memCache) return memCache;
  try {
    const raw = fs.readFileSync(TOKEN_FILE, "utf-8");
    memCache = JSON.parse(raw);
    return memCache;
  } catch {
    return null;
  }
}

function saveTokens(store: TokenStore) {
  memCache = store;
  try {
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error("Failed to persist Sharesight tokens:", e);
  }
}

export async function getAccessToken(): Promise<string> {
  const store = loadTokens();
  const now = Date.now() / 1000;
  if (store && store.access_token && now < store.expires_at - 60) {
    return store.access_token;
  }
  return refreshAccessToken();
}

export async function refreshAccessToken(): Promise<string> {
  const clientId = process.env.SHARESIGHT_CLIENT_ID;
  const clientSecret = process.env.SHARESIGHT_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("SHARESIGHT_CLIENT_ID / SHARESIGHT_CLIENT_SECRET not set in .env.local");
  }

  // Use persisted refresh token first, fall back to env var
  const store = loadTokens();
  const refreshToken = store?.refresh_token ?? process.env.SHARESIGHT_REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("No Sharesight refresh token available — re-authorise the app");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Token refresh returned no access_token: ${JSON.stringify(data)}`);
  }

  const expiresAt = (data.created_at ?? Math.floor(Date.now() / 1000)) + (data.expires_in ?? 1800);
  saveTokens({
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_at: expiresAt,
  });

  return data.access_token;
}

/** Seed the token store from env vars (call once after first OAuth2 exchange) */
export function seedTokensFromEnv(accessToken: string, refreshToken: string, expiresIn = 1800) {
  saveTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
  });
}

export interface SharesightHolding {
  id: number;
  symbol: string;
  market: string;
  name: string;
  quantity: number;
  value: number;
  capital_gain: number;
  capital_gain_percent: number;
  payout_gain: number;
}

export interface SharesightPerformance {
  holdings: SharesightHolding[];
}

export async function fetchPortfolioPerformance(portfolioId: string | number): Promise<SharesightPerformance> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}/portfolios/${portfolioId}/performance.json`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sharesight portfolio ${portfolioId} fetch failed: ${res.status}`);
  return res.json();
}

export function calcAvgCost(holding: SharesightHolding): number {
  const { value, capital_gain_percent, quantity } = holding;
  if (quantity === 0) return 0;
  const divisor = 1 + capital_gain_percent / 100;
  if (divisor === 0) return 0;
  const costBasis = value / divisor;
  return costBasis / quantity;
}

/** Returns true if the symbol is an APIR code (managed fund) — e.g. FSF0581AU */
export function isApirCode(symbol: string): boolean {
  return /^[A-Z]{3}\d{4}[A-Z]{2}$/.test(symbol);
}

/** Normalise a Sharesight symbol to our portfolio ticker format */
export function normaliseTicker(symbol: string, market: string): string {
  if (isApirCode(symbol)) return symbol;
  if (market === "ASX") return `${symbol}.AX`;
  return symbol;
}
