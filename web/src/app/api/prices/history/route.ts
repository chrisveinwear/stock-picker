import { NextRequest, NextResponse } from "next/server";
import { getPriceHistory } from "@/lib/yahoo-finance";

export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");
  const period = (req.nextUrl.searchParams.get("period") ?? "1y") as "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
  if (!ticker) return NextResponse.json({ error: "ticker param required" }, { status: 400 });

  try {
    const history = await getPriceHistory(ticker, period);
    return NextResponse.json(history);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
