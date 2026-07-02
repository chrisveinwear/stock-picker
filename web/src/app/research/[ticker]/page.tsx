import { getReportsByTicker } from "@/lib/report-store";
import { getQuote } from "@/lib/yahoo-finance";
import { MDXRemote } from "next-mdx-remote/rsc";
import remarkGfm from "remark-gfm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { notFound } from "next/navigation";
import Link from "next/link";
import DeleteReportButton from "../DeleteReportButton";
import PriceRangeChart from "@/components/PriceRangeChart";
import FairValueHistoryChart from "@/components/FairValueHistoryChart";
import ValuationCard from "@/components/ValuationCard";
import { readValuationSidecar } from "@/lib/valuation/store";

export const dynamic = "force-dynamic";

const verdictStyles: Record<string, string> = {
  buy: "bg-emerald-900 text-emerald-300 border-emerald-700",
  watch: "bg-amber-900 text-amber-300 border-amber-700",
  avoid: "bg-red-900 text-red-300 border-red-700",
  hold: "bg-blue-900 text-blue-300 border-blue-700",
};

export default async function ReportPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const decodedTicker = decodeURIComponent(ticker);
  const reports = getReportsByTicker(decodedTicker);
  const latest = reports[0];

  if (!latest) notFound();

  const fm = latest.frontmatter;

  // Code valuation sidecar (audit/transparency), keyed by the report's file date.
  const reportDateStr = latest.filePath.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] ?? null;
  const valuationSidecar = reportDateStr ? readValuationSidecar(decodedTicker, reportDateStr) : null;

  // Commodity reports (gold, silver, etc.) use AUD frontmatter fields and spot price —
  // not a live Yahoo Finance equity quote
  const isCommodity = !!fm.commodity;

  let quote = null;
  if (!isCommodity) {
    try { quote = await getQuote(decodedTicker); } catch {}
  }

  // For commodities: prefer AUD fields, fall back to base-currency fields
  const ivLow  = isCommodity ? (fm.intrinsicValueLowAUD  ?? fm.intrinsicValueLow)  : fm.intrinsicValueLow;
  const ivHigh = isCommodity ? (fm.intrinsicValueHighAUD ?? fm.intrinsicValueHigh) : fm.intrinsicValueHigh;
  const displayPrice = isCommodity
    ? (fm.spotPriceAUD ?? fm.spotPriceBrent ?? fm.spotPrice ?? null)
    : (quote?.lastPrice ?? null);
  const priceUnit = isCommodity ? (fm.unit ?? "AUD/oz") : "";

  const mos = ivHigh && displayPrice
    ? ((ivHigh - displayPrice) / ivHigh) * 100
    : null;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{fm.ticker ?? decodedTicker}</h1>
            {fm.verdict && (
              <Badge className={`capitalize text-sm px-3 py-1 border ${verdictStyles[fm.verdict] ?? "bg-zinc-700 text-zinc-300"}`}>
                {fm.verdict}
              </Badge>
            )}
          </div>
          {(fm.companyName || fm.company) && <p className="text-zinc-400 mt-1">{fm.companyName ?? fm.company}</p>}
          <p className="text-zinc-500 text-sm mt-0.5">Report date: {fm.reportDate ?? fm.date}</p>
        </div>
        {displayPrice && (
          <div className="text-right">
            <p className="text-2xl font-bold">${displayPrice.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{priceUnit ? ` ${priceUnit}` : ""}</p>
            {!isCommodity && quote?.changePercent != null && (
              <p className={`text-sm ${quote.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {quote.changePercent >= 0 ? "+" : ""}{quote.changePercent.toFixed(2)}% today
              </p>
            )}
            {isCommodity && <p className="text-xs text-zinc-500 mt-0.5">at report date</p>}
          </div>
        )}
      </div>

      {(ivLow || ivHigh || mos != null) && (
        <div className="grid grid-cols-3 gap-4">
          {ivLow && ivHigh && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wide">
                  {isCommodity ? "Incentive Price Range" : "Intrinsic Value"}
                </p>
                <p className="text-lg font-bold mt-1">
                  ${ivLow.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}–${ivHigh.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {isCommodity && priceUnit && <p className="text-xs text-zinc-500 mt-0.5">{priceUnit}</p>}
              </CardContent>
            </Card>
          )}
          {displayPrice && (
            <Card className="bg-zinc-900 border-zinc-800">
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wide">
                  {isCommodity ? "Spot Price" : "Current Price"}
                </p>
                <p className="text-lg font-bold mt-1">
                  ${displayPrice.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
                {isCommodity && priceUnit && <p className="text-xs text-zinc-500 mt-0.5">{priceUnit}</p>}
              </CardContent>
            </Card>
          )}
          {mos != null && (
            <Card className={`border ${mos >= 30 ? "bg-emerald-950 border-emerald-800" : "bg-zinc-900 border-zinc-800"}`}>
              <CardContent className="pt-4">
                <p className="text-xs text-zinc-400 uppercase tracking-wide">Margin of Safety</p>
                <p className={`text-lg font-bold mt-1 ${mos >= 30 ? "text-emerald-400" : mos >= 0 ? "text-amber-400" : "text-red-400"}`}>
                  {mos.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Price range chart — shown when the report has per-lens price data */}
      {fm.priceLenses && Array.isArray(fm.priceLenses) && fm.priceLenses.length > 0 && fm.consensusBuyBelow && fm.consensusSellAbove && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-5 pb-4">
            <p className="text-xs text-zinc-400 uppercase tracking-wider mb-4 font-medium">
              Price Range Analysis — Buy / Hold / Sell Zones by Lens
            </p>
            <PriceRangeChart
              lenses={fm.priceLenses}
              consensusBuyBelow={fm.consensusBuyBelow}
              consensusSellAbove={fm.consensusSellAbove}
              intrinsicValueLow={fm.intrinsicValueLow}
              intrinsicValueHigh={fm.intrinsicValueHigh}
              currentPrice={
                // For USD-denominated commodities, use USD spot price to match the lens scale
                isCommodity && (fm.unit as string | undefined)?.includes("USD")
                  ? ((fm.spotPrice ?? fm.spotPriceBrent ?? fm.spotPriceWTI) as number | undefined)
                  : (displayPrice ?? undefined)
              }
              currency={isCommodity ? (fm.unit?.includes("USD") ? "US$" : "$") : "$"}
            />
          </CardContent>
        </Card>
      )}

      {/* Code valuation model vs report IV vs analyst — transparency & reconciliation */}
      {valuationSidecar && <ValuationCard sidecar={valuationSidecar} />}

      {/* Fair value vs price over time — fills out as monthly refreshes accumulate */}
      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="pt-5 pb-4">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-4 font-medium">
            {isCommodity ? "Incentive Price vs Spot — History" : "Price vs Fair Value — History"}
          </p>
          <FairValueHistoryChart
            ticker={fm.ticker ?? decodedTicker}
            isCommodity={isCommodity}
            currency={isCommodity ? (fm.unit?.includes("USD") ? "US$" : "$") : "$"}
          />
        </CardContent>
      </Card>

      {reports.length > 1 && (
        <div className="flex gap-2 text-sm">
          <span className="text-zinc-500">Previous reports:</span>
          {reports.slice(1).map((r, i) => {
            const d = (r.frontmatter.reportDate ?? r.frontmatter.date) as string | undefined;
            return <span key={d ?? i} className="text-zinc-400">{d ?? "—"}</span>;
          })}
        </div>
      )}

      <article className="prose prose-invert prose-zinc max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-li:text-zinc-300 prose-strong:text-zinc-100 prose-code:text-zinc-200 prose-pre:bg-zinc-900 prose-hr:border-zinc-700 prose-table:w-full prose-thead:border-zinc-700 prose-tr:border-zinc-800 prose-th:text-zinc-300 prose-th:font-semibold prose-th:px-3 prose-th:py-2 prose-td:text-zinc-400 prose-td:px-3 prose-td:py-2">
        <MDXRemote source={latest.content} options={{ mdxOptions: { format: "md", remarkPlugins: [remarkGfm] } }} />
      </article>

      <div className="pt-4 flex items-center justify-between">
        <Link href="/research" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors">← All reports</Link>
        <DeleteReportButton ticker={decodedTicker} redirectTo="/research" />
      </div>
    </div>
  );
}
