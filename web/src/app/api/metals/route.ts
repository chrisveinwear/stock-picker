import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { metalHoldings } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const items = db.select().from(metalHoldings).all();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();

  const { metal, label, ounces, avgCostAud, location, storageType, purchaseDate, account, notes } = body;
  if (!metal || !ounces) {
    return NextResponse.json({ error: "metal and ounces are required" }, { status: 400 });
  }

  const result = db.insert(metalHoldings).values({
    metal: metal.toLowerCase(),
    label,
    ounces: Number(ounces),
    avgCostAud: avgCostAud ? Number(avgCostAud) : null,
    location,
    storageType,
    purchaseDate,
    account: account ?? "personal",
    notes,
    updatedAt: new Date().toISOString(),
  }).returning().get();

  return NextResponse.json(result, { status: 201 });
}
