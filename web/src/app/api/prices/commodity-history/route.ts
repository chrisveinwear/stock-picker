import { NextRequest, NextResponse } from "next/server";
import { getCommodityPriceHistory } from "@/lib/yahoo-finance";

export const dynamic = "force-dynamic";

/**
 * GET /api/prices/commodity-history?commodity=GOLD&period=2y&currency=aud
 * Historical spot for a physical commodity (gold, silver, oil, …). USD by
 * default; pass currency=aud to convert via AUDUSD history (for AUD reports).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const commodity = sp.get("commodity");
  if (!commodity) return NextResponse.json({ error: "commodity param required" }, { status: 400 });

  const period = (sp.get("period") ?? "2y") as "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
  const currency = (sp.get("currency") === "aud" ? "aud" : "usd") as "usd" | "aud";

  try {
    const history = await getCommodityPriceHistory(commodity, period, currency);
    return NextResponse.json(history);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
