import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { watchlist, researchReports } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const items = db.select().from(watchlist).orderBy(desc(watchlist.addedAt)).all();

  // Attach the latest AI-consensus buy/sell thresholds per ticker so the UI
  // reflects the same zones the alert engine uses.
  const reports = db.select().from(researchReports).orderBy(desc(researchReports.reportDate)).all();
  const reportMap: Record<string, (typeof reports)[number]> = {};
  for (const r of reports) {
    if (!(r.ticker in reportMap)) reportMap[r.ticker] = r;
  }

  const enriched = items.map((w) => ({
    ...w,
    buyBelow: reportMap[w.ticker]?.buyBelow ?? null,
    sellAbove: reportMap[w.ticker]?.sellAbove ?? null,
  }));
  return NextResponse.json(enriched);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const ticker = body.ticker?.trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const normTicker = ticker.includes(".") ? ticker : `${ticker}.AX`;
  db.insert(watchlist).values({ ...body, ticker: normTicker }).run();
  return NextResponse.json({ ok: true });
}
