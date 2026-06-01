import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { portfolioHoldings } from "@/db/schema";
import {
  fetchPortfolioPerformance,
  calcAvgCost,
  isApirCode,
  normaliseTicker,
} from "@/lib/sharesight";

export const dynamic = "force-dynamic";

/** Holdings to skip — expired instruments */
const EXPIRED_SYMBOLS = new Set(["CIM", "LNK"]);

/**
 * POST/GET /api/sharesight/sync
 * Query params:
 *   portfolioId  — Sharesight portfolio ID (default: 515525 = personal)
 *   account      — "personal" | "maxwell" | "super" (default: derived from portfolioId)
 */
export async function POST(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const portfolioId = searchParams.get("portfolioId") ?? process.env.SHARESIGHT_PORTFOLIO_ID ?? "515525";
  // Infer account from portfolioId if not explicitly set
  const defaultAccount = portfolioId === "1280686" ? "maxwell" : "personal";
  const account = searchParams.get("account") ?? defaultAccount;

  try {
    const perf = await fetchPortfolioPerformance(portfolioId);
    const db = getDb();
    const results: { ticker: string; action: string; shares: number; avgCost: number }[] = [];

    for (const h of perf.holdings) {
      if (EXPIRED_SYMBOLS.has(h.symbol)) continue;

      const ticker = normaliseTicker(h.symbol, h.market);
      const avgCost = calcAvgCost(h);
      const isSuper = isApirCode(h.symbol);
      const priceType = isSuper ? "manual" : "live";
      const source = isSuper ? "super" : "sharesight";
      // Super fund goes under personal account (it's in the user's Sharesight, not Maxwell's)
      const holdingAccount = isSuper ? "super" : account;
      const manualPrice = isSuper ? h.value / h.quantity : null;

      db.insert(portfolioHoldings)
        .values({
          ticker,
          companyName: h.name,
          shares: h.quantity,
          avgCost,
          account: holdingAccount,
          source,
          priceType,
          manualPrice,
          updatedAt: new Date().toISOString(),
        })
        .onConflictDoUpdate({
          target: [portfolioHoldings.ticker, portfolioHoldings.account],
          set: {
            companyName: h.name,
            shares: h.quantity,
            avgCost,
            account: holdingAccount,
            source,
            priceType,
            manualPrice,
            updatedAt: new Date().toISOString(),
          },
        })
        .run();

      results.push({ ticker, action: "upserted", shares: h.quantity, avgCost });
    }

    return NextResponse.json({ ok: true, account, portfolioId, synced: results.length, holdings: results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
