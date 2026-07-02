import { listReports, readReport } from "@/lib/report-store";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { getQuote } from "@/lib/yahoo-finance";
import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import RequestResearchButton from "./RequestResearchButton";
import MorningstarImportButton from "./MorningstarImportButton";
import RegenerateReportButton from "./RegenerateReportButton";
import RegenerateAllButton from "./RegenerateAllButton";
import DeleteReportButton from "./DeleteReportButton";

// Metals share the commodity generation path but want the "metal" report type.
const METALS = new Set(["gold", "silver", "platinum", "palladium"]);

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
    const fs = fsReports.filter((r) => r.ticker === ticker)[0];
    const report = fs ? readReport(fs.filePath) : null;
    // Report type drives regeneration: a `commodity` frontmatter field marks a
    // commodity/metal report (metals by name); everything else is an equity.
    const commodity = report?.frontmatter.commodity?.toString().toLowerCase();
    const type: "stock" | "metal" | "commodity" = !commodity
      ? "stock"
      : METALS.has(commodity)
      ? "metal"
      : "commodity";
    const companyName = db?.companyName ?? report?.frontmatter.company ?? report?.frontmatter.companyName ?? null;
    const intrinsicValueLow = db?.intrinsicValueLow ?? report?.frontmatter.intrinsicValueLow ?? null;
    const intrinsicValueHigh = db?.intrinsicValueHigh ?? report?.frontmatter.intrinsicValueHigh ?? null;

    // Margin of safety = discount of current price to the top of the IV range,
    // computed live. The stored frontmatter `marginOfSafety` is unreliable — the
    // LLM emits it inconsistently as a fraction or a percentage — so we recompute
    // from IV + live price. We deliberately use `intrinsicValueHigh` (the value
    // shown on the card) and a price in the SAME currency: live quote for equities,
    // base-currency spot for commodities (the card's IV is base currency, so using
    // the AUD spot here would mix units and skew the %).
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
    const mos = intrinsicValueHigh && price ? ((intrinsicValueHigh - price) / intrinsicValueHigh) * 100 : null;

    return {
      ticker,
      companyName,
      type,
      generatedBy: db?.generatedBy ?? report?.frontmatter.generatedBy ?? null,
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
