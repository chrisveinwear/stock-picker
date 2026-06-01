import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { portfolioHoldings } from "@/db/schema";

export async function GET() {
  const db = getDb();
  const items = db.select().from(portfolioHoldings).all();
  return NextResponse.json(items);
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
  db.insert(portfolioHoldings).values({ ...body, ticker: normTicker, priceType, account }).onConflictDoUpdate({
    target: [portfolioHoldings.ticker, portfolioHoldings.account],
    set: { shares: body.shares, avgCost: body.avgCost, manualPrice: body.manualPrice ?? null, priceType, account, updatedAt: new Date().toISOString() },
  }).run();
  return NextResponse.json({ ok: true });
}
