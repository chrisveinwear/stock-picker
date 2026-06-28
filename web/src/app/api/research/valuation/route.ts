import { NextRequest, NextResponse } from "next/server";
import { readValuationSidecar } from "@/lib/valuation/store";
import { getReportsByTicker } from "@/lib/report-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/research/valuation?ticker=CSL.AX[&date=YYYY-MM-DD]
 * Returns the valuation sidecar (code model + LLM IV + divergence) for a report.
 * Defaults to the latest report date for the ticker.
 */
export async function GET(req: NextRequest) {
  const ticker = req.nextUrl.searchParams.get("ticker");
  let date = req.nextUrl.searchParams.get("date");
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });

  if (!date) {
    const reports = getReportsByTicker(ticker);
    date = (reports[0]?.frontmatter.reportDate as string | undefined) ?? reports[0]?.frontmatter.date ?? null;
    if (typeof date !== "string") {
      // derive from filepath basename if frontmatter date missing
      const fp = reports[0]?.filePath ?? "";
      const m = fp.match(/(\d{4}-\d{2}-\d{2})\.md$/);
      date = m ? m[1] : null;
    }
  }
  if (!date) return NextResponse.json({ error: "no report date found" }, { status: 404 });

  const sidecar = readValuationSidecar(ticker, date);
  if (!sidecar) return NextResponse.json({ error: "no valuation sidecar for this report" }, { status: 404 });
  return NextResponse.json(sidecar);
}
