import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { stockPicks } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const db = getDb();
  const items = db.select().from(stockPicks).orderBy(desc(stockPicks.createdAt)).all();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();
  const ticker = body.ticker?.trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const normTicker = ticker.includes(".") ? ticker : `${ticker}.AX`;
  db.insert(stockPicks).values({ ...body, ticker: normTicker }).run();
  return NextResponse.json({ ok: true });
}
