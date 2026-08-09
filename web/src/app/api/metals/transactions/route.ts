import { NextRequest, NextResponse } from "next/server";
import { desc, eq, and } from "drizzle-orm";
import { getDb } from "@/db";
import { metalTransactions } from "@/db/schema";
import { recomputeMetalLedger } from "@/lib/metals";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const account = searchParams.get("account");
  const metal = searchParams.get("metal");

  const conditions = [];
  if (account) conditions.push(eq(metalTransactions.account, account));
  if (metal) conditions.push(eq(metalTransactions.metal, metal.toLowerCase()));

  const items = conditions.length
    ? db.select().from(metalTransactions).where(and(...conditions)).orderBy(desc(metalTransactions.date), desc(metalTransactions.id)).all()
    : db.select().from(metalTransactions).orderBy(desc(metalTransactions.date), desc(metalTransactions.id)).all();

  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();

  const { metal, type, date, ounces, pricePerOzAud, feeAud, totalAud, account, source, orderId, notes } = body;
  if (!metal || !type || !date || ounces == null) {
    return NextResponse.json({ error: "metal, type, date and ounces are required" }, { status: 400 });
  }
  if (type !== "buy" && type !== "sell") {
    return NextResponse.json({ error: "type must be 'buy' or 'sell'" }, { status: 400 });
  }

  const metalLower = metal.toLowerCase();
  const acct = account ?? "personal";
  const unsignedOunces = Math.abs(Number(ounces));
  const price = pricePerOzAud != null ? Number(pricePerOzAud) : null;
  const fee = feeAud != null ? Number(feeAud) : 0;
  const signedOunces = type === "sell" ? -unsignedOunces : unsignedOunces;
  const computedTotal = price != null
    ? (type === "buy" ? -(unsignedOunces * price + fee) : unsignedOunces * price - fee)
    : null;

  const result = db.insert(metalTransactions).values({
    metal: metalLower,
    type,
    date,
    ounces: signedOunces,
    pricePerOzAud: price,
    feeAud: fee,
    totalAud: totalAud != null ? Number(totalAud) : computedTotal,
    account: acct,
    source: source ?? "Manual entry",
    orderId: orderId ?? null,
    notes: notes ?? null,
  }).returning().get();

  recomputeMetalLedger(db, acct, metalLower);

  return NextResponse.json(result, { status: 201 });
}
