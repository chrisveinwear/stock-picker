/**
 * Bare research tickers that mean a physical metal, never an equity. Shared by
 * the research page, the refresh queue and the generate route so a metal
 * can't slip into the equity pipeline — "GOLD" as a stock resolves to GOLD.AX
 * (an ETF), which produced a Perth Mint ETF report instead of a commodity one.
 */
export const METAL_TICKERS = new Set(["gold", "silver", "platinum", "palladium"]);

export function isMetalTicker(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return !t.includes(".") && METAL_TICKERS.has(t);
}
