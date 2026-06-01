import { listReports, readReport } from "@/lib/report-store";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";
import { desc } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import Link from "next/link";
import RequestResearchButton from "./RequestResearchButton";

export const dynamic = "force-dynamic";

const verdictStyles: Record<string, string> = {
  buy: "bg-emerald-900 text-emerald-300",
  watch: "bg-amber-900 text-amber-300",
  avoid: "bg-red-900 text-red-300",
  hold: "bg-blue-900 text-blue-300",
};

export default function ResearchPage() {
  // Merge DB metadata with filesystem reports
  const db = getDb();
  const dbReports = db.select().from(researchReports).orderBy(desc(researchReports.reportDate)).all();
  const fsReports = listReports();

  // Build unified list — prefer DB metadata, fall back to frontmatter
  const allTickers = new Set([
    ...dbReports.map((r) => r.ticker),
    ...fsReports.map((r) => r.ticker),
  ]);

  const reportsByTicker = Array.from(allTickers).map((ticker) => {
    const db = dbReports.filter((r) => r.ticker === ticker)[0];
    const fs = fsReports.filter((r) => r.ticker === ticker)[0];
    const report = fs ? readReport(fs.filePath) : null;
    return {
      ticker,
      companyName: db?.companyName ?? report?.frontmatter.company ?? null,
      verdict: db?.verdict ?? report?.frontmatter.verdict ?? null,
      reportDate: db?.reportDate ?? fs?.date ?? null,
      intrinsicValueLow: db?.intrinsicValueLow ?? report?.frontmatter.intrinsicValueLow ?? null,
      intrinsicValueHigh: db?.intrinsicValueHigh ?? report?.frontmatter.intrinsicValueHigh ?? null,
      marginOfSafety: db?.marginOfSafety ?? report?.frontmatter.marginOfSafety ?? null,
    };
  }).sort((a, b) => (b.reportDate ?? "").localeCompare(a.reportDate ?? ""));

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Research Reports</h1>
          <p className="text-zinc-400 text-sm mt-1">Buffett-style analysis on ASX stocks, metals & commodities</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="bg-zinc-800 text-zinc-300">{reportsByTicker.length} reports</Badge>
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
            <Link key={r.ticker} href={`/research/${encodeURIComponent(r.ticker)}`}>
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
                </div>
                <div className="flex items-center gap-6 text-sm text-zinc-400">
                  {r.intrinsicValueLow && r.intrinsicValueHigh && (
                    <span>IV ${r.intrinsicValueLow}–${r.intrinsicValueHigh}</span>
                  )}
                  {r.marginOfSafety != null && (
                    <span className={r.marginOfSafety >= 0.3 ? "text-emerald-400" : ""}>
                      {(r.marginOfSafety * 100).toFixed(0)}% MOS
                    </span>
                  )}
                  {r.reportDate && <span className="text-zinc-500">{r.reportDate}</span>}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
