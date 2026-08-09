import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { metalTransactions } from "@/db/schema";
import { recomputeMetalLedger } from "@/lib/metals";

export const dynamic = "force-dynamic";

// Maxwell has no Perth Mint account of his own — his gold is bought out of
// the personal pooled balance. Every Maxwell buy/sell here is recorded
// alongside an identical (date, quantity, price) sell/buy in the personal
// account, so the two registers always split the one physical balance.
export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();

  const { metal, type, date, ounces, pricePerOzAud, feeAud, notes } = body;
  if (!metal || !type || !date || ounces == null || pricePerOzAud == null) {
    return NextResponse.json({ error: "metal, type, date, ounces and pricePerOzAud are required" }, { status: 400 });
  }
  if (type !== "buy" && type !== "sell") {
    return NextResponse.json({ error: "type must be 'buy' or 'sell'" }, { status: 400 });
  }

  const metalLower = metal.toLowerCase();
  const unsignedOunces = Math.abs(Number(ounces));
  const price = Number(pricePerOzAud);
  const fee = feeAud != null ? Number(feeAud) : 0;
  const mirrorType = type === "buy" ? "sell" : "buy";

  const maxwellSigned = type === "sell" ? -unsignedOunces : unsignedOunces;
  const maxwellTotal = type === "buy" ? -(unsignedOunces * price + fee) : unsignedOunces * price - fee;

  const mirrorSigned = -maxwellSigned;
  const mirrorTotal = -maxwellTotal;

  const maxwellTx = db.insert(metalTransactions).values({
    metal: metalLower,
    type,
    date,
    ounces: maxwellSigned,
    pricePerOzAud: price,
    feeAud: fee,
    totalAud: maxwellTotal,
    account: "maxwell",
    source: "Manual entry",
    notes: notes ?? null,
  }).returning().get();

  const mirrorTx = db.insert(metalTransactions).values({
    metal: metalLower,
    type: mirrorType,
    date,
    ounces: mirrorSigned,
    pricePerOzAud: price,
    feeAud: 0,
    totalAud: mirrorTotal,
    account: "personal",
    source: "Internal transfer to Maxwell",
    notes: `Mirror of Maxwell's ${type} on ${date}`,
  }).returning().get();

  recomputeMetalLedger(db, "maxwell", metalLower);
  const personal = recomputeMetalLedger(db, "personal", metalLower);
  const maxwell = recomputeMetalLedger(db, "maxwell", metalLower);

  return NextResponse.json({ maxwellTx, mirrorTx, personal, maxwell }, { status: 201 });
}
