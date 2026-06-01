import { NextResponse } from "next/server";
import { getMetalPrices } from "@/lib/yahoo-finance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const prices = await getMetalPrices();
    return NextResponse.json(prices);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
