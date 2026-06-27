import { NextRequest, NextResponse } from "next/server";
import { getFairValueSeries } from "@/lib/report-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/research/history?ticker=CSL.AX
 * Returns the fair-value / verdict time series for a ticker (oldest first),
 * for charting how the valuation has evolved across reports.
 */
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");
  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }
  try {
    const series = getFairValueSeries(ticker.trim().toUpperCase());
    return NextResponse.json({ ticker, series });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
