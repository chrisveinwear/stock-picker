import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { fundTransactions } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker");
  const account = searchParams.get("account");

  const conditions = [];
  if (ticker) conditions.push(eq(fundTransactions.ticker, ticker.toUpperCase()));
  if (account) conditions.push(eq(fundTransactions.account, account));

  const items = conditions.length
    ? db.select().from(fundTransactions).where(and(...conditions)).orderBy(desc(fundTransactions.date), desc(fundTransactions.id)).all()
    : db.select().from(fundTransactions).orderBy(desc(fundTransactions.date), desc(fundTransactions.id)).all();

  return NextResponse.json(items);
}
