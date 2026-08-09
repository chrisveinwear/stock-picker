import { listReports, readReport } from "@/lib/report-store";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { getQuote } from "@/lib/yahoo-finance";
import { marginOfSafetyPct } from "@/lib/mos";
import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import RequestResearchButton from "./RequestResearchButton";
import MorningstarImportButton from "./MorningstarImportButton";
import RegenerateReportButton from "./RegenerateReportButton";
import RegenerateAllButton from "./RegenerateAllButton";
import DeleteReportButton from "./DeleteReportButton";

import { METAL_TICKERS as METALS } from "@/lib/metal-tickers";

export const dynamic = "force-dynamic";

const verdictStyles: Record<string, string> = {
  buy: "bg-emerald-900 text-emerald-300",
  watch: "bg-amber-900 text-amber-300",
  avoid: "bg-red-900 text-red-300",
  hold: "bg-blue-900 text-blue-300",
};

export default async function ResearchPage() {
  // Merge DB metadata with filesystem reports
  const db = getDb();
  const dbReports = db.select().from(researchReports).orderBy(desc(researchReports.reportDate)).all();
  const fsReports = listReports();

  // Build unified list — prefer DB metadata, fall back to frontmatter
  const allTickers = new Set([
    ...dbReports.map((r) => r.ticker),
    ...fsReports.map((r) => r.ticker),
  ]);

  const reportsByTicker = (await Promise.all(Array.from(allTickers).map(async (ticker) => {
    const db = dbReports.filter((r) => r.ticker === ticker)[0];
    // Classify from the newest report with REAL frontmatter — error stubs (a
    // 73-byte 401 message once became GOLD's latest file) carry no `commodity`
    // field and silently reclassified metals as stocks, so Regenerate then ran
    // the equity pipeline against the GOLD.AX ETF instead of physical gold.
    const fsCandidates = fsReports.filter((r) => r.ticker === ticker);
    const fs = fsCandidates[0];
    let report = null;
    for (const candidate of fsCandidates) {
      const parsed = readReport(candidate.filePath);
      if (parsed && (parsed.frontmatter.verdict != null || parsed.frontmatter.commodity != null)) {
        report = parsed;
        break;
      }
    }
    // Report type drives regeneration: a `commodity` frontmatter field marks a
    // commodity/metal report; a bare metal-name ticker (GOLD, SILVER…) is a
    // metal even if no valid report survives; everything else is an equity.
    const commodity = report?.frontmatter.commodity?.toString().toLowerCase();
    const type: "stock" | "metal" | "commodity" = commodity
      ? (METALS.has(commodity) ? "metal" : "commodity")
      : METALS.has(ticker.toLowerCase())
      ? "metal"
      : "stock";
    const companyName = db?.companyName ?? report?.frontmatter.company ?? report?.frontmatter.companyName ?? null;
    const intrinsicValueLow = db?.intrinsicValueLow ?? report?.frontmatter.intrinsicValueLow ?? null;
    const intrinsicValueHigh = db?.intrinsicValueHigh ?? report?.frontmatter.intrinsicValueHigh ?? null;

    // Margin of safety = discount of current price to the IV midpoint (the
    // app-wide convention in lib/mos.ts, matching CLAUDE.md and the report
    // text), computed live — the stored frontmatter `marginOfSafety` is
    // unreliable (the LLM emits it inconsistently as a fraction or a percent).
    // The price must be in the SAME currency as the IV: live quote for
    // equities, base-currency spot for commodities (the card's IV is base
    // currency, so using the AUD spot here would mix units and skew the %).
    let price: number | null = null;
    if (commodity) {
      price =
        report?.frontmatter.spotPrice ??
        report?.frontmatter.spotPriceBrent ??
        report?.frontmatter.spotPriceWTI ??
        null;
    } else {
      try { price = (await getQuote(ticker))?.lastPrice ?? null; } catch {}
    }
    const mos = marginOfSafetyPct(intrinsicValueLow, intrinsicValueHigh, price);

    const integrityFlags = Array.isArray(report?.frontmatter.integrityFlags)
      ? (report.frontmatter.integrityFlags as string[])
      : [];

    return {
      ticker,
      companyName,
      type,
      generatedBy: db?.generatedBy ?? report?.frontmatter.generatedBy ?? null,
      integrityFlags,
      verdict: db?.verdict ?? report?.frontmatter.verdict ?? null,
      reportDate: db?.reportDate ?? fs?.date ?? null,
      intrinsicValueLow,
      intrinsicValueHigh,
      mos,
    };
  }))).sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research Reports</h1>
          <p className="text-zinc-400 text-sm mt-1">Buffett-style analysis on ASX stocks, metals & commodities</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-zinc-800 text-zinc-300">{reportsByTicker.length} reports</Badge>
          <a
            href="/api/morningstar/template"
            download
            title="Download an Excel template with the columns the Morningstar import expects — fill it in and upload it with Import Morningstar"
            className={`${buttonVariants({ variant: "outline" })} border-zinc-700 text-zinc-300 text-sm`}
          >
            ⤓ Template
          </a>
          <MorningstarImportButton />
          <RegenerateAllButton
            targets={reportsByTicker.map((r) => ({ ticker: r.ticker, type: r.type, name: r.companyName }))}
          />
          <RequestResearchButton />
        </div>
      </div>

      {reportsByTicker.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6">
            <p className="text-zinc-400 text-sm">No reports yet. Ask Claude to analyse a stock:</p>
            <pre className="mt-3 text-xs bg-zinc-800 rounded p-3 text-zinc-300">
              Analyse ASX:CBA as Warren Buffett would
            </pre>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {reportsByTicker.map((r) => (
            <div key={r.ticker} className="relative group">
              <Link href={`/research/${encodeURIComponent(r.ticker)}`}>
                <div className="flex items-center justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 transition-colors">
                  <div className="flex items-center gap-4">
                    <div>
                      <span className="font-semibold">{r.ticker}</span>
                      {r.companyName && <span className="text-zinc-400 text-sm ml-2">{r.companyName}</span>}
                    </div>
                    {r.verdict && (
                      <Badge className={`capitalize text-xs ${verdictStyles[r.verdict] ?? "bg-zinc-700 text-zinc-300"}`}>
                        {r.verdict}
                      </Badge>
                    )}
                    {r.generatedBy && (
                      <span
                        className="text-[10px] uppercase tracking-wide text-zinc-600"
                        title={`Generated by ${r.generatedBy}`}
                      >
                        {String(r.generatedBy).includes("nemotron")
                          ? "Nemotron"
                          : String(r.generatedBy).toLowerCase().includes("claude")
                          ? "Claude"
                          : String(r.generatedBy).split(":")[0]}
                      </span>
                    )}
                    {r.integrityFlags.length > 0 && (
                      <Badge
                        className="bg-red-950 text-red-400 text-[10px]"
                        title={`Integrity validation flagged:\n${r.integrityFlags.join("\n")}`}
                      >
                        ⚠ unverified data
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-6 text-sm text-zinc-400">
                    {r.intrinsicValueLow && r.intrinsicValueHigh && (
                      <span>IV ${r.intrinsicValueLow}–${r.intrinsicValueHigh}</span>
                    )}
                    {r.mos != null && (
                      <span className={r.mos >= 30 ? "text-emerald-400" : r.mos < 0 ? "text-red-400" : ""}>
                        {r.mos.toFixed(0)}% MOS
                      </span>
                    )}
                    {r.reportDate && <span className="text-zinc-500">{r.reportDate}</span>}
                    <RegenerateReportButton ticker={r.ticker} type={r.type} name={r.companyName} />
                    <DeleteReportButton ticker={r.ticker} />
                  </div>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
