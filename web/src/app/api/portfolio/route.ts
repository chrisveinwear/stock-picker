import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { portfolioHoldings, fundTransactions } from "@/db/schema";

export async function GET() {
  const db = getDb();
  const items = db.select().from(portfolioHoldings).all();
  const ledgerRows = db.selectDistinct({ ticker: fundTransactions.ticker, account: fundTransactions.account }).from(fundTransactions).all();
  const ledgerKeys = new Set(ledgerRows.map((r) => `${r.ticker}|${r.account}`));
  const withLedgerFlag = items.map((h) => ({ ...h, hasLedger: ledgerKeys.has(`${h.ticker}|${h.account}`) }));
  return NextResponse.json(withLedgerFlag);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const ticker = body.ticker?.trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  // Managed funds (APIR codes like FSF0581AU) keep their ticker as-is; ASX stocks get .AX suffix
  const isApir = /^[A-Z]{3}\d{4}[A-Z]{2}$/.test(ticker);
  const normTicker = isApir ? ticker : ticker.includes(".") ? ticker : `${ticker}.AX`;
  const priceType = isApir ? "manual" : (body.priceType ?? "live");
  const account = body.account ?? (isApir ? "super" : "personal");

  // Ledger-backed holdings (e.g. FSF0581AU) derive units/avg cost from
  // fund_transactions — reject manual edits here so they can't be silently
  // clobbered; import a new statement into fund_transactions instead.
  const isLedgerBacked = db.select().from(fundTransactions)
    .where(and(eq(fundTransactions.ticker, normTicker), eq(fundTransactions.account, account)))
    .limit(1).all().length > 0;
  if (isLedgerBacked) {
    return NextResponse.json(
      { error: `${normTicker} (${account}) is derived from a transaction ledger — import a new statement instead of editing it here.` },
      { status: 409 },
    );
  }

  db.insert(portfolioHoldings).values({ ...body, ticker: normTicker, priceType, account }).onConflictDoUpdate({
    target: [portfolioHoldings.ticker, portfolioHoldings.account],
    set: { shares: body.shares, avgCost: body.avgCost, manualPrice: body.manualPrice ?? null, priceType, account, updatedAt: new Date().toISOString() },
  }).run();
  return NextResponse.json({ ok: true });
}
