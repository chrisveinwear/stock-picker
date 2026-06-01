import { NextRequest, NextResponse } from "next/server";
import { getQuotes } from "@/lib/yahoo-finance";

export async function GET(req: NextRequest) {
  const tickers = req.nextUrl.searchParams.get("tickers");
  if (!tickers) {
    return NextResponse.json({ error: "tickers param required" }, { status: 400 });
  }

  try {
    const quotes = await getQuotes(tickers.split(",").map((t) => t.trim()));
    return NextResponse.json(quotes);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
