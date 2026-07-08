/**
 * Research report generation. Providers (see lib/ai/report-providers):
 *  - "claude" (default within "auto"): the Claude Code CLI subprocess. Requires
 *    the one-time login: `"$CLAUDE_BINARY" login`
 *  - "nemotron": OpenRouter free Nemotron endpoint (OPENROUTER_API_KEY)
 *  - "auto": Claude first, Nemotron when Claude is unavailable/out of credits
 */
import { NextRequest } from "next/server";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports, alertLog } from "@/db/schema";
import { fetchRecentNews, formatNewsForPrompt } from "@/lib/news-fetcher";
import { addReportToWatchlist } from "@/lib/watchlist";
import {
  getCommodityPriceHistory,
  getEquityFundamentals,
  getPriceHistory,
  type FinancialYear,
} from "@/lib/yahoo-finance";
import {
  computeTechnicals,
  formatTechnicalsForPrompt,
  formatTechnicalsTableMarkdown,
  spliceTechnicalsTable,
  type TechnicalReading,
} from "@/lib/technicals";
import {
  validateReportIntegrity,
  formatViolationsForRetry,
  type IntegrityViolation,
} from "@/lib/ai/report-validator";
import { isMetalTicker } from "@/lib/metal-tickers";
import { marginOfSafetyPct } from "@/lib/mos";
import { resolveReportThresholds, type ThresholdModel } from "@/lib/report-thresholds";
import { runEquityValuation, type ValuationResult } from "@/lib/valuation";
import { formatMorningstarForPrompt } from "@/lib/morningstar";
import { runCommodityValuation, type CommodityValuationResult } from "@/lib/valuation/commodity";
import { describeModelTemplate } from "@/lib/valuation/model-template";
import { saveValuationSidecar } from "@/lib/valuation/store";
import {
  formatHistoryForPrompt,
  getPreviousReport,
  detectMaterialChange,
} from "@/lib/report-history";
import {
  claudeAvailable,
  generateWithClaudeCli,
  generateWithOpenRouter,
  inlineReferenceDoc,
  OPENROUTER_MODEL,
  type GenerationResult,
  type ReportProvider,
} from "@/lib/ai/report-providers";

// Generous ceiling for the slow free Nemotron endpoint (only enforced on
// serverless platforms; harmless self-hosted). The OpenRouter client aborts
// itself at 14 min / 3 min of stall — see lib/ai/report-providers.
export const maxDuration = 900;

const PROJECT_ROOT = path.join(process.cwd(), "..");

/** Local-timezone calendar date. toISOString() is UTC, which stamps reports
 *  generated before ~10am AEST with the previous day's date. */
function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Live spot price for a physical commodity, as a prompt instruction. Without
 * this the model anchors on the previous report's stale spot. Returns "" when
 * the commodity has no Yahoo symbol (the model then falls back to news context).
 */
async function fetchCommoditySpot(ticker: string): Promise<string> {
  try {
    const [usd, aud] = await Promise.all([
      getCommodityPriceHistory(ticker, "1mo", "usd"),
      getCommodityPriceHistory(ticker, "1mo", "aud"),
    ]);
    const u = usd[usd.length - 1];
    const a = aud[aud.length - 1];
    if (!u) return "";
    const usdStr = `US$${u.close.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    const audStr = a ? ` (A$${a.close.toLocaleString("en-AU", { maximumFractionDigits: 0 })})` : "";
    return `\n\n## Current Spot Price (authoritative)\n\nThe live spot price as of ${u.date} is **${usdStr}${audStr}**. You MUST use this exact figure as the current spot price throughout the report (frontmatter spotPrice/spotPriceAUD and all narrative). Do NOT carry over the spot price from any previous report — the market has moved.`;
  } catch {
    return "";
  }
}

/**
 * Authoritative live fundamentals for an equity, injected into the prompt so the
 * model never infers price/financials from memory (which produced fabricated
 * inputs — e.g. valuing Amcor off a hallucinated price and an invented reverse
 * split). Includes the analyst consensus target as an external sanity check, plus
 * a reconciliation guard against the model's own intrinsic value.
 */
async function fetchEquitySnapshot(ticker: string): Promise<string> {
  const f = await getEquityFundamentals(ticker);
  if (!f || f.price == null) return "";

  const cur = f.priceCurrency ?? "AUD";
  const fcur = f.financialCurrency ?? cur;
  const n = (v: number | null, d = 2) =>
    v == null ? "n/a" : v.toLocaleString("en-US", { maximumFractionDigits: d });
  const bn = (v: number | null) => (v == null ? "n/a" : `${(v / 1e9).toFixed(2)}bn`);
  const pc = (v: number | null) => (v == null ? "n/a" : `${v.toFixed(1)}%`);
  // Yahoo reports debtToEquity as a PERCENTAGE (e.g. 41.2 = 0.41x) — convert to a
  // ratio so the model doesn't read 41x leverage against the D/E < 1.0x screen.
  const de =
    f.debtToEquity == null ? "n/a" : `${(f.debtToEquity > 5 ? f.debtToEquity / 100 : f.debtToEquity).toFixed(2)}x`;

  const lines: string[] = [
    `- Current price: ${cur} ${n(f.price)} (prev close ${n(f.previousClose)})`,
    `- Sector: ${f.sector ?? "n/a"} · Industry: ${f.industry ?? "n/a"}`,
    `- Market cap: ${cur} ${bn(f.marketCap)} · Shares outstanding: ${f.sharesOutstanding != null ? `${(f.sharesOutstanding / 1e6).toFixed(1)}m` : "n/a"}`,
    `- P/E trailing ${n(f.trailingPE, 1)} · P/E forward ${n(f.forwardPE, 1)} · P/B ${n(f.priceToBook, 2)}`,
    `- EPS trailing ${n(f.epsTrailing)} · EPS forward ${n(f.epsForward)} · Dividend yield ${pc(f.dividendYieldPct)} · Beta ${n(f.beta, 2)}`,
    `- 52-week range: ${n(f.fiftyTwoWeekLow)} – ${n(f.fiftyTwoWeekHigh)}`,
    `- Financials (${fcur}): revenue ${bn(f.totalRevenue)} · EBITDA ${bn(f.ebitda)} · FCF ${bn(f.freeCashflow)} · total debt ${bn(f.totalDebt)} · cash ${bn(f.totalCash)}`,
    `- Margins: gross ${pc(f.grossMarginsPct)} · operating ${pc(f.operatingMarginsPct)} · net ${pc(f.profitMarginsPct)} · ROE ${pc(f.returnOnEquityPct)} · D/E ${de}`,
  ];
  if (f.targetMeanPrice != null) {
    lines.push(
      `- Analyst consensus 12m target: ${cur} ${n(f.targetMeanPrice)} (range ${n(f.targetLowPrice)}–${n(f.targetHighPrice)}, ${f.numberOfAnalystOpinions ?? "?"} analysts, rating "${f.recommendationKey ?? "n/a"}")`
    );
  }

  return `\n\n## Current Market Data (authoritative — use these exact figures)

These are the live, verified market data and fundamentals for ${ticker}. You MUST anchor the report to them:
- Use **${cur} ${n(f.price)}** as the current share price everywhere (frontmatter and narrative). Do NOT infer the price, share count, or any corporate action (splits, consolidations) from memory — if you "remember" a different price, it is stale; trust these figures.
- Note the reporting currency is ${fcur}; convert consistently and state the FX rate used.
${lines.join("\n")}

Reconciliation guard: after computing your intrinsic value, compare its midpoint to the current price above. If they differ by more than ~40%, STOP and re-examine your inputs and assumptions before finalising — a large gap to a liquid market price (and to the analyst consensus target) is far more often a sign of an input error on your side than a genuine 40%+ mispricing. Explicitly explain any remaining gap. Sanity-check your P/E, EPS and per-share figures against the authoritative numbers above.`;
}

/**
 * Multi-year statement table so the Part B lenses (revenue CAGR, margin trends,
 * balance-sheet health) are computed from real filings, not recalled from memory.
 */
function formatFinancialHistoryForPrompt(history: FinancialYear[], financialCurrency: string): string {
  if (!history.length) return "";
  const m = (v: number | null) => (v == null ? "n/a" : (v / 1e6).toFixed(0));
  const rows = history
    .map(
      (h) =>
        `| ${h.date} | ${m(h.totalRevenue)} | ${m(h.netIncome)} | ${m(h.operatingCashFlow)} | ${m(h.freeCashFlow)} | ${m(h.capitalExpenditure)} | ${m(h.totalDebt)} | ${m(h.cashAndCashEquivalents)} | ${m(h.stockholdersEquity)} |`
    )
    .join("\n");
  return `\n\n## Annual Financial History (authoritative — ${financialCurrency} millions, from filings)

Use this table for any multi-year figure in the report (revenue CAGR, margin trends, debt trajectory). Do NOT recall historical financials from memory.

| FY end | Revenue | Net income | Op cash flow | FCF | Capex | Total debt | Cash | Equity |
|---|---|---|---|---|---|---|---|---|
${rows}`;
}

/** Computed technical indicators for the Citadel lens. Returns the prompt
 *  block plus the raw reading (the integrity validator anchors against it);
 *  both empty/null when history is thin. */
async function fetchTechnicalsBlock(
  ticker: string,
  currency: string
): Promise<{ block: string; reading: TechnicalReading | null }> {
  try {
    const daily = await getPriceHistory(ticker, "2y", "1d");
    const t = computeTechnicals(daily);
    return { block: t ? formatTechnicalsForPrompt(t, currency) : "", reading: t };
  } catch {
    return { block: "", reading: null };
  }
}

/**
 * Render the deterministic code valuation + canonical model structure + a
 * mandatory reconciliation instruction. The LLM must present its valuation using
 * this fixed structure (it may argue assumption VALUES, never the structure), and
 * must reconcile its IV against this code IV and the analyst target transparently.
 */
function formatValuationForPrompt(v: ValuationResult): string {
  const c = v.currency;
  const n = (x: number | null | undefined, d = 2) =>
    x == null ? "n/a" : x.toLocaleString("en-US", { maximumFractionDigits: d });
  const assumptionLines = Object.entries(v.assumptions)
    .map(([k, t]) => `  - ${k}: ${t.value} [${t.source}${t.note ? `, ${t.note}` : ""}]`)
    .join("\n");
  const warnLines = v.warnings.length
    ? v.warnings.map((w) => `  - ${w}`).join("\n")
    : "  - none";

  return `\n\n## Independent Valuation Model (deterministic — produced in code)

${describeModelTemplate()}

Code-computed result (the quantitative backbone — use it; do not invent a parallel arithmetic):
- Code fair value: **${c} ${n(v.codeFairValue)}** · IV range ${c} ${n(v.codeIvLow)}–${n(v.codeIvHigh)}
- Discount rate (CAPM cost of equity): ${(v.discountRate * 100).toFixed(1)}% · stage-1 growth ${(v.stage1Growth * 100).toFixed(1)}% fading to terminal · quality tier: ${v.qualityTier} (owner-earnings multiple ${v.ownerEarningsMultiple}x, terminal exit multiple ${v.exitMultiple}x)
- Net debt (context only — the DCF discounts post-interest owner earnings, so it is NOT deducted again): ${c} ${n(v.netDebt / 1e9)}bn
- Method triangulation: DCF ${n(v.methods.dcf)} · owner-earnings-multiple ${n(v.methods.ownerEarningsMultiple)} · Graham ${v.methods.graham == null ? "n/a" : n(v.methods.graham)} · reverse-DCF implied growth ${v.methods.impliedGrowth == null ? "n/a" : (v.methods.impliedGrowth * 100).toFixed(1) + "%"}
- Normalised earnings base: ${v.baseBasis}
- Analyst consensus target: ${v.analystTargetMean == null ? "n/a" : c + " " + n(v.analystTargetMean)}
- Assumptions used (source-tagged):
${assumptionLines}
- Model warnings:
${warnLines}

REQUIRED — Valuation reconciliation (must be transparent, never hidden):
1. Produce your own intrinsic value via the canonical methods above.
2. Compute the divergence of your IV midpoint from (a) this code fair value and (b) the analyst target.
3. If divergence from the code fair value exceeds ~20%, add a dedicated "**Valuation Reconciliation**" subsection in Part A section 6 that: (a) checks each authoritative input for error/hallucination, (b) identifies which ASSUMPTION(S) — not the model structure — drive the gap, (c) proposes adjusted assumptions with rationale, (d) states the reconciled IV and any residual gap, and (e) notes any model warnings above. Do not change the model STRUCTURE; only argue assumption values.
4. Your frontmatter intrinsicValueLow/High should be your reconciled view; the code model value is recorded separately by the system.`;
}

/**
 * Render the deterministic commodity incentive-price model + a reconciliation
 * instruction. Commodities are valued on the cost curve (incentive price vs
 * spot), NOT a DCF — the canonical commodity model structure is fixed; the LLM
 * may argue the cost-curve assumption VALUES, never the structure.
 */
function formatCommodityValuationForPrompt(v: CommodityValuationResult): string {
  const u = v.currency; // unit, e.g. USD/oz
  const n = (x: number | null | undefined) => (x == null ? "n/a" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  const assumptionLines = Object.entries(v.assumptions)
    .map(([k, t]) => `  - ${k}: ${t.value} [${t.source}${t.note ? `, ${t.note}` : ""}]`)
    .join("\n");
  const warnLines = v.warnings.length ? v.warnings.map((w) => `  - ${w}`).join("\n") : "  - none";

  return `\n\n## Independent Valuation Model (deterministic — produced in code)

Canonical commodity model: ${v.modelVersion}
This is the FIXED commodity valuation structure (cost curve + incentive price) used for every commodity — present your valuation using it and do NOT substitute a DCF or a different structure. You may argue for different cost-curve assumption VALUES, never a different model shape.
- Fair value = the incentive price (greenfield supply at ~15% IRR; the long-run equilibrium).
- Decision: buy when spot is below the incentive price; avoid when spot is well above it (oversupply will be incentivised); the 90th-percentile AISC is the cost-curve floor/ceiling.

Code-computed result (the quantitative backbone — use it; do not invent a parallel calculation):
- Incentive price (fair value): **${n(v.codeFairValue)} ${u}** · value zone ${n(v.codeIvLow)}–${n(v.codeIvHigh)} ${u}
- Live spot: ${n(v.price)} ${u} (${v.spotVsIncentivePct == null ? "n/a" : (v.spotVsIncentivePct > 0 ? "+" : "") + v.spotVsIncentivePct.toFixed(0) + "% vs incentive"})
- Cost curve: AISC 50th ${n(v.costCurve.aisc50)} · AISC 90th ${n(v.costCurve.aisc90)} ${u} · thesis ${v.costCurve.thesis} · estimates as of ${v.costCurve.asOf || "n/a"} (${v.costCurve.source || "unsourced"})
- Zones: buy below ${n(v.buyBelow)} · avoid above ${n(v.sellAbove)} ${u} · code verdict zone: ${v.verdictZone}
- Cost-curve assumptions (source-tagged — these are MAINTAINED estimates, update them if stale):
${assumptionLines}
- Model warnings:
${warnLines}

REQUIRED — Valuation reconciliation (must be transparent, never hidden):
1. Set your frontmatter intrinsicValueLow/High to your incentive-price range.
2. Compute the divergence of your incentive-price midpoint from this code incentive price.
3. If divergence exceeds ~20%, add a dedicated "**Valuation Reconciliation**" subsection that: (a) checks the cost-curve inputs (AISC, incentive price) for staleness/error, (b) identifies which cost-curve ASSUMPTION drives the gap and proposes an updated value with rationale, (c) for a monetary metal trading far above cost, explicitly reconciles the cost view against the monetary/safe-haven demand thesis, (d) states the reconciled incentive price and any residual gap. Do not change the model STRUCTURE; only argue assumption values.`;
}

function buildPrompt(
  ticker: string,
  type: "stock" | "metal" | "commodity",
  name?: string,
  newsContext?: string,
  historyContext?: string,
  marketContext?: string,
  morningstarContext?: string
): string {
  const date = today();
  const label = name ? `${ticker} (${name})` : ticker;
  const historySection = historyContext ?? "";
  const marketSection = marketContext ?? "";
  const morningstarSection = morningstarContext ?? "";
  // Only advertise the Morningstar lens in the priceLenses spec when we actually
  // have imported data for this ticker — otherwise the LLM would fabricate it.
  const morningstarLens = morningstarSection
    ? `
  - name: "Morningstar"
    buyBelow: <number — Morningstar implied fair value adjusted down for its uncertainty band>
    fairValue: <number — Morningstar implied fair value = live price ÷ Price/Fair Value>
    sellAbove: <number — Morningstar implied fair value adjusted up for its uncertainty band>`
    : "";

  const priceLensesInstruction = `
The frontmatter MUST include a priceLenses YAML array summarising the buy/hold/sell price targets from each applicable institutional lens in Part B, followed by consensus values. Every number must be a bare numeric value with no currency symbol or units.

priceLenses:
  - name: "Goldman Sachs"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Morgan Stanley DCF"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "JPMorgan"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Citadel Technical"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Bridgewater Risk"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Bain Competitive"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Renaissance Quant"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "McKinsey Macro"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>${morningstarLens}
consensusBuyBelow: <number — weighted consensus of all lens buyBelow values; this is the AI recommended maximum buy price>
consensusSellAbove: <number — weighted consensus of all lens sellAbove values; this is the AI recommended minimum sell price>

Coherence rules (the thresholds must not contradict your own valuation):
- consensusBuyBelow MUST be ≤ intrinsicValueLow (you only buy at or below the low end of fair value).
- consensusSellAbove MUST be ≥ intrinsicValueHigh (never recommend selling below your own fair-value ceiling).
- For every lens: buyBelow < fairValue < sellAbove.
- Lens targets are your judgment ANCHORED to the code model fair value and the authoritative data above. The system computes the actual buy/sell alert thresholds independently from the code model; your lens targets are commentary.`;

  const dataIntegrityRules = `
## Data Integrity Rules (mandatory — apply to every section)

- Every numeric claim must come from the data provided in this prompt (market snapshot, financial history table, computed technicals, valuation model, news, Morningstar) or be clearly labelled as an assumption with its basis. Never present a remembered or estimated figure as data.
- ASX companies report HALF-YEARLY, not quarterly. In the earnings-analysis section, analyse the most recent half-year/full-year results using the financial history and news provided. Consensus-estimate history, beat/miss records and post-earnings price reactions are NOT provided — state "consensus history not available" instead of inventing an estimates table.
- In the technical-analysis section, use ONLY the readings in the "Computed Technicals" block, verbatim. Do not invent indicator values, chart patterns, or volume behaviour beyond what those figures support. If the block is absent, state that technical data was unavailable.
- Insider-trading, short-interest and institutional-ownership data are NOT provided. In the quant-patterns section, state explicitly that these datapoints are unavailable rather than inventing figures; seasonal/behavioural commentary must be clearly framed as qualitative.
- Peer comparisons may use well-known structural facts (who the competitors are, rough relative scale) but present peer FINANCIAL figures as approximate and flag them as unverified.`;

  const newsSection = newsContext ? `\n\n## Live Market Context\n\nThe following recent news and ASX announcements were fetched immediately before generating this report. Use them to inform current sentiment, recent events, and any catalyst or risk sections:\n\n${newsContext}` : "";

  if (type === "stock") {
    return `Analyse ASX:${ticker}${name ? ` — ${name}` : ""} as Warren Buffett would.

Generate a comprehensive investment research report following the full analysis format in CLAUDE.md. Include all 17 sections (Part A sections 1–8 and Part B sections 9–17). Start the output with the YAML frontmatter block (between --- markers).

Today's date: ${date}
${marketSection}
${morningstarSection}
${newsSection}
${historySection}
${dataIntegrityRules}

${priceLensesInstruction}

Output ONLY the complete markdown report, beginning directly with the YAML frontmatter block delimited by --- lines. Do NOT wrap the frontmatter or any part of the report in code fences (no \`\`\`yaml or \`\`\`markdown). Do NOT use any tools and do NOT save the file yourself — just print the raw markdown report to stdout. No preamble or commentary outside the report.`;
  }

  const commodityLensesInstruction = `
The frontmatter MUST include a priceLenses YAML array summarising the buy/hold/sell price targets from each applicable analysis lens, adapted to the commodity context (e.g. Wood Mackenzie cost curve, Goldman supply/demand, etc.), followed by consensus values. Every number must be a bare numeric value with no currency symbol or units. Use the same currency/unit as the rest of the frontmatter (AUD/oz for metals, USD/bbl for oil, etc.).

priceLenses:
  - name: "Cost Curve"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Supply/Demand"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Macro Cycle"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Technical"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
  - name: "Incentive Price"
    buyBelow: <number>
    fairValue: <number>
    sellAbove: <number>
consensusBuyBelow: <number — weighted consensus buy price>
consensusSellAbove: <number — weighted consensus sell price>`;

  const commodityNewsSection = newsContext ? `\n\n## Live Market Context\n\nThe following recent news and price commentary were fetched immediately before generating this report. Use them to inform current supply/demand dynamics, macro sentiment, and price catalyst sections:\n\n${newsContext}` : "";

  return `Analyse ${label} as a physical ${type} investment.

Generate a comprehensive research report using the commodity analysis framework from COMMODITIES.md. Adapt all 17 sections to the commodity context — replace equity-focused sections with their commodity equivalents (supply/demand, cost curve, incentive price, etc.). Start the output with the YAML frontmatter block (between --- markers) — set intrinsicValueLow/High to the incentive price range.

The frontmatter \`verdict\` MUST be exactly one of these four values (lowercase): buy | watch | hold | avoid. Do NOT invent other labels (no "reduce", "sell", "trim", "accumulate"). Map your conclusion as follows: spot well below the incentive price and attractive to add now → "buy"; below incentive price but not yet compelling, worth monitoring for an entry → "watch"; fairly priced, keep existing exposure but don't add → "hold"; trading at a rich premium to the incentive price / 90th-percentile cost where new capital should stay away and holders may trim → "avoid". Use the same canonical wording in the VERDICT line of the report body.

Today's date: ${date}
${marketSection}
${commodityNewsSection}
${historySection}

${commodityLensesInstruction}

Output ONLY the complete markdown report, beginning directly with the YAML frontmatter block delimited by --- lines. Do NOT wrap the frontmatter or any part of the report in code fences (no \`\`\`yaml or \`\`\`markdown). Do NOT use any tools and do NOT save the file yourself — just print the raw markdown report to stdout. No preamble or commentary outside the report.`;
}

/** Buy/sell alert thresholds derived from the CODE valuation model. Whether
 *  they actually reach the DB is decided by resolveReportThresholds at save
 *  time, which can reject an equity model that flags low confidence or
 *  diverges too far from the report's own IV range. */
export type CodeThresholds = ThresholdModel & { source: string };

function deriveCodeThresholds(
  valuation: ValuationResult | CommodityValuationResult | null
): CodeThresholds | null {
  if (!valuation || !(valuation.codeFairValue > 0)) return null;
  if (valuation.kind === "commodity") {
    // The commodity model's zones (incentive price / oversupply band) come from
    // the maintained cost curve — valid even when the live-spot fetch failed.
    return {
      buyBelow: valuation.buyBelow,
      sellAbove: valuation.sellAbove,
      source: `${valuation.modelVersion} incentive zones`,
      kind: "commodity",
      fairValue: valuation.codeFairValue,
      lowConfidence: false,
    };
  }
  if (!valuation.ok) return null; // equity model built on missing inputs — don't trust it
  const mos = valuation.assumptions.marginOfSafety?.value ?? 0.30;
  return {
    buyBelow: valuation.codeFairValue * (1 - mos),
    sellAbove: valuation.codeFairValue * (1 + mos),
    source: `${valuation.modelVersion} fair value ±${(mos * 100).toFixed(0)}% MOS`,
    kind: "equity",
    fairValue: valuation.codeFairValue,
    lowConfidence: valuation.sensitivity.lowConfidence,
  };
}

function saveReportToDB(
  ticker: string,
  filePath: string,
  content: string,
  codeThresholds: CodeThresholds | null,
  autoWatchlist: boolean,
  generatedBy: string,
  livePrice: number | null
) {
  try {
    const { data } = matter(content);

    // Reject reports whose frontmatter didn't parse into a real report (e.g. the
    // CLI bailed out mid-generation). Without this, malformed output creates rows
    // with NULL buy/sell thresholds that silently break the alert engine.
    const isValid =
      data &&
      typeof data === "object" &&
      data.verdict != null &&
      (data.intrinsicValueLow != null || data.intrinsicValueHigh != null);
    if (!isValid) {
      console.error(
        `Report frontmatter invalid for ${ticker} — skipping DB save (no verdict/IV found)`
      );
      return;
    }

    const db = getDb();
    // Always use the caller's canonical ticker (e.g. "GOLD", "CSL.AX"), never the
    // model's frontmatter ticker — it sometimes drifts (e.g. "XAU"), which would
    // fragment the DB, watch list, history and material-change detection.
    const finalTicker = ticker;
    // YAML parses bare ISO dates (reportDate: 2026-06-27) into Date objects,
    // which SQLite can't bind — normalise to a YYYY-MM-DD string.
    const rawDate = data.reportDate ?? today();
    const reportDate =
      rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : String(rawDate);

    // Capture the prior report (any date other than this one) BEFORE we write,
    // so we can detect material changes versus the last published view.
    const previousReport = getPreviousReport(finalTicker, reportDate);

    db.delete(researchReports)
      .where(
        and(
          eq(researchReports.ticker, finalTicker),
          eq(researchReports.reportDate, reportDate)
        )
      )
      .run();

    const ivLow = data.intrinsicValueLow ?? null;
    const ivHigh = data.intrinsicValueHigh ?? null;

    // Alert thresholds: credible code model first, report lens consensus as
    // fallback, IV coherence clamp for stocks — see lib/report-thresholds.ts
    // for the full policy.
    const isCommodityReport = !!data.commodity || codeThresholds?.kind === "commodity";
    const { buyBelow, sellAbove, modelRejectedReason } = resolveReportThresholds({
      model: codeThresholds,
      consensusBuyBelow: data.consensusBuyBelow ?? null,
      consensusSellAbove: data.consensusSellAbove ?? null,
      ivLow,
      ivHigh,
      isCommodity: isCommodityReport,
    });
    if (modelRejectedReason) {
      console.log(`[thresholds] ${ticker}: ${modelRejectedReason} — using report consensus`);
    }

    // Stored MOS is system-computed to one convention: % discount of the price
    // to the IV midpoint (per CLAUDE.md). The LLM's frontmatter value is unit-
    // inconsistent (sometimes fraction, sometimes percent) and only kept as a
    // last resort when no price is available to compute from.
    const mosPrice = livePrice ?? (isCommodityReport
      ? (data.spotPrice ?? data.spotPriceBrent ?? data.spotPriceWTI ?? null)
      : null);
    const mosLive = marginOfSafetyPct(ivLow, ivHigh, mosPrice);
    const marginOfSafety =
      mosLive != null ? Number(mosLive.toFixed(1)) : data.marginOfSafety ?? null;

    db.insert(researchReports)
      .values({
        ticker: finalTicker,
        companyName: data.companyName ?? data.company ?? null,
        reportDate,
        verdict: data.verdict ?? null,
        intrinsicValueLow: ivLow,
        intrinsicValueHigh: ivHigh,
        marginOfSafety,
        buyBelow,
        sellAbove,
        filePath,
        generatedBy,
      })
      .run();

    // Automatically add researched STOCKS to the watch list (idempotent).
    // Commodities are excluded: the alert engine would quote "GOLD" as GOLD.AX
    // (the BetaShares ETF) and compare an ETF share price to per-ounce thresholds.
    if (autoWatchlist) {
      addReportToWatchlist({
        ticker: finalTicker,
        companyName: data.companyName ?? data.company ?? null,
        intrinsicValueLow: ivLow,
        intrinsicValueHigh: ivHigh,
        buyBelow,
      });
    }

    // Material-change detection: verdict flip or a fair-value move beyond the
    // threshold versus the previous report. Logged to alert_log so it surfaces
    // in the app's existing alerts feed (de-duped per ticker/type/day).
    const changes = detectMaterialChange(previousReport, {
      verdict: data.verdict ?? null,
      intrinsicValueLow: data.intrinsicValueLow ?? null,
      intrinsicValueHigh: data.intrinsicValueHigh ?? null,
    });
    for (const change of changes) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const dupe = db
        .select({ id: alertLog.id })
        .from(alertLog)
        .where(
          and(
            eq(alertLog.ticker, finalTicker),
            eq(alertLog.alertType, change.kind),
            gte(alertLog.triggeredAt, cutoff)
          )
        )
        .get();
      if (dupe) continue;
      db.insert(alertLog)
        .values({
          ticker: finalTicker,
          alertType: change.kind,
          triggerPrice: change.newFairValue,
          targetPrice: change.previousFairValue,
          marginOfSafety: change.changePct,
        })
        .run();
      console.log(`[material-change] ${finalTicker}: ${change.detail}`);
    }
  } catch (e) {
    console.error("DB save error:", e);
  }
}

/**
 * Extract a clean markdown report (frontmatter + body) from the raw CLI output.
 * Defends against two observed deviations: (1) leading tool-use narration before
 * the report, and (2) the YAML frontmatter wrapped in a ```yaml code fence with
 * stray `---` horizontal rules around it. Returns `---\n<yaml>\n---\n\n<body>`.
 */
function extractReport(raw: string): string {
  // Unwrap a fenced frontmatter block (```yaml\n---\n…\n---\n```) → bare ---…---
  const text = raw.replace(/```ya?ml\s*\n(---\n[\s\S]*?\n---)\s*\n```/, "$1");

  // Anchor on the real frontmatter: the `---` line immediately before `ticker:`.
  const tickerIdx = text.search(/\nticker:\s/);
  if (tickerIdx !== -1) {
    const open = text.lastIndexOf("\n---", tickerIdx);
    const close = text.indexOf("\n---", tickerIdx);
    if (open !== -1 && close !== -1 && close > open) {
      const yaml = text.slice(open + 4, close).trim();
      let body = text.slice(close + 4);
      // Drop leading whitespace, an optional stray closing fence, and stray `---` rules.
      body = body
        .replace(/^\s*(?:```+\s*)?/, "")
        .replace(/^(?:---+\s*\n)+/, "")
        .trimStart();
      return `---\n${yaml}\n---\n\n${body.trimEnd()}`;
    }
  }

  // Fallback: slice from the first `---` and unwrap a whole-report code fence.
  let reportContent = text;
  const firstDash = text.indexOf("---");
  if (firstDash !== -1) reportContent = text.slice(firstDash);
  const codeBlockMatch = reportContent.match(/^---\s*\n```(?:markdown)?\n([\s\S]*?)```[\s\S]*$/);
  if (codeBlockMatch) {
    reportContent = codeBlockMatch[1].trim();
  } else {
    const lastCodeFence = reportContent.lastIndexOf("\n```");
    if (lastCodeFence !== -1 && !reportContent.slice(lastCodeFence + 4).trim().startsWith("\n#")) {
      reportContent = reportContent.slice(0, lastCodeFence).trim();
    }
  }
  return reportContent.trim();
}

export async function POST(req: NextRequest) {
  const { ticker, type: requestedType, name, provider = "auto" } = (await req.json()) as {
    ticker: string;
    type: "stock" | "metal" | "commodity";
    name?: string;
    provider?: ReportProvider;
  };

  if (!ticker) {
    return new Response(JSON.stringify({ error: "ticker required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Providers to try, in order. "auto" = Claude with Nemotron as the fallback.
  const providerChain: Exclude<ReportProvider, "auto">[] =
    provider === "auto" ? ["claude", "nemotron"] : [provider];

  if (provider === "claude" && !claudeAvailable()) {
    return new Response(
      JSON.stringify({ error: "Claude CLI not found — install/login the Claude Code CLI or pick another model" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
  if (provider === "nemotron" && !process.env.OPENROUTER_API_KEY) {
    return new Response(
      JSON.stringify({ error: "OPENROUTER_API_KEY is not set in web/.env.local — add it to use the Nemotron model" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const tickerUpper = ticker.trim().toUpperCase();
  // A bare metal name always means the physical commodity, never an equity —
  // as a "stock" it would gain .AX and analyse the GOLD.AX ETF (which
  // happened: a stub report broke type detection upstream and the pipeline
  // produced a Perth Mint ETF report titled GOLD).
  const type: "stock" | "metal" | "commodity" =
    requestedType === "stock" && isMetalTicker(tickerUpper) ? "metal" : requestedType;
  if (type !== requestedType) {
    console.warn(`[generate] ${tickerUpper}: requested type "stock" coerced to "metal"`);
  }
  const asxTicker =
    type === "stock" && !tickerUpper.includes(".")
      ? `${tickerUpper}.AX`
      : tickerUpper;

  const newsResult = await fetchRecentNews(asxTicker, name?.trim());
  const newsContext = formatNewsForPrompt(newsResult);
  const historyContext = formatHistoryForPrompt(asxTicker);

  // Deterministic valuation engine. Runs before the LLM so its computed IV +
  // assumptions are injected as the quantitative backbone and the LLM must
  // reconcile against it transparently. Equity → DCF; commodity → incentive price.
  let valuation: ValuationResult | CommodityValuationResult | null = null;
  let valuationContext = "";
  try {
    if (type === "stock") {
      const v = await runEquityValuation(asxTicker);
      // A degraded run (missing price/shares/earnings base) must not be injected
      // as the quantitative anchor — its numbers are built on absent inputs.
      if (v.ok) {
        valuation = v;
        valuationContext = formatValuationForPrompt(v);
      } else {
        console.error(`[valuation] ${asxTicker} inputs incomplete — model not injected:`, v.warnings);
      }
    } else {
      const v = await runCommodityValuation(asxTicker);
      // Commodity `ok` only reflects the live-spot fetch; the maintained cost
      // curve (fair value, zones) is valid regardless — inject when it exists.
      if (v.codeFairValue > 0) {
        valuation = v;
        valuationContext = formatCommodityValuationForPrompt(v);
      } else {
        console.error(`[valuation] ${asxTicker} has no maintained cost curve — model not injected:`, v.warnings);
      }
    }
  } catch (e) {
    console.error("[valuation] engine failed:", e);
  }

  // Alert thresholds are derived from the code model up-front (LLM output never
  // moves them; its consensus numbers are archived in the sidecar instead).
  const codeThresholds = deriveCodeThresholds(valuation);

  let marketContext = "";
  let technicalsReading: TechnicalReading | null = null;
  let livePrice: number | null = null;
  let priceCurrency = "AUD";
  if (type === "stock") {
    const f = await getEquityFundamentals(asxTicker); // cached — same fetch the engine used
    livePrice = f?.price ?? null;
    priceCurrency = f?.priceCurrency ?? "AUD";
    const snapshot = await fetchEquitySnapshot(asxTicker);
    const technicals = await fetchTechnicalsBlock(asxTicker, f?.priceCurrency ?? "AUD");
    technicalsReading = technicals.reading;
    const historyBlock =
      valuation?.kind === "equity"
        ? formatFinancialHistoryForPrompt(valuation.history, f?.financialCurrency ?? f?.priceCurrency ?? "AUD")
        : "";
    marketContext = snapshot + historyBlock + technicals.block + valuationContext;
  } else {
    marketContext = (await fetchCommoditySpot(asxTicker)) + valuationContext;
  }

  // Morningstar lens — only present if the user has imported a snapshot for this
  // ticker. Pass the live price so we can surface an implied fair value.
  const morningstarContext =
    type === "stock"
      ? formatMorningstarForPrompt(asxTicker, (await getEquityFundamentals(asxTicker))?.price ?? null)
      : "";

  const prompt = buildPrompt(asxTicker, type, name?.trim(), newsContext, historyContext, marketContext, morningstarContext);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Browsers kill long silent streams, so the client may vanish mid-run —
      // generation and saving must finish headless. enqueue on a closed
      // controller throws; swallow it and keep going.
      let clientGone = false;
      const emit = (text: string) => {
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          clientGone = true;
          console.error("[generate] client disconnected — continuing headless");
        }
      };
      const close = () => {
        try { controller.close(); } catch { /* already closed */ }
      };

      // Tool-less Claude runs can stream nothing until the very end (~20 min);
      // heartbeat dots keep the connection alive through the silence.
      let lastActivity = Date.now();
      const trackedEmit = (text: string) => {
        lastActivity = Date.now();
        emit(text);
      };
      const heartbeat = setInterval(() => {
        if (Date.now() - lastActivity >= 15_000) emit(" ·");
      }, 15_000);

      (async () => {
        // Run the provider chain once for a given prompt; returns a successful
        // result, or null after emitting the terminal error itself.
        type SuccessResult = Extract<GenerationResult, { ok: true }>;
        const runChain = async (basePrompt: string): Promise<SuccessResult | null> => {
          let result: GenerationResult | null = null;
          for (let i = 0; i < providerChain.length; i++) {
            const p = providerChain[i];
            // API models can't read CLAUDE.md/COMMODITIES.md from disk — inline it.
            const providerPrompt = p === "nemotron" ? inlineReferenceDoc(basePrompt, type) : basePrompt;
            result =
              p === "claude"
                ? await generateWithClaudeCli(providerPrompt, trackedEmit)
                : await generateWithOpenRouter(providerPrompt, trackedEmit);

            if (result.ok) return result;

            const hasNext = i < providerChain.length - 1;
            if (result.unavailable && hasNext) {
              console.error(`[generate] ${p} unavailable — falling back:`, result.error);
              emit(`\n\n⚠ ${result.error}\n→ Falling back to ${OPENROUTER_MODEL} via OpenRouter…\n\n`);
              continue;
            }

            emit(`\n\n__ERROR__:${result.error}`);
            return null;
          }
          emit(`\n\n__ERROR__:No provider produced a report`);
          return null;
        };

        // Generate → validate integrity in code → on fabrication errors,
        // regenerate ONCE with the violations spelled out; if they persist,
        // save anyway with visible integrityFlags (never silently publish).
        const MAX_GEN_PASSES = 2;
        let result: SuccessResult | null = null;
        let violations: IntegrityViolation[] = [];
        for (let pass = 1; pass <= MAX_GEN_PASSES; pass++) {
          const passPrompt = pass === 1 ? prompt : prompt + formatViolationsForRetry(violations);
          result = await runChain(passPrompt);
          if (!result) return; // terminal error already emitted

          // Validate the extracted report (frontmatter unfenced, narration
          // stripped) — the same content that will be persisted.
          violations = validateReportIntegrity(extractReport(result.output), {
            type,
            technicals: technicalsReading,
            price: livePrice,
          });
          const errors = violations.filter((v) => v.severity === "error");
          if (errors.length === 0) break;

          console.error(`[integrity] ${asxTicker} pass ${pass} violations:`, errors);
          if (pass < MAX_GEN_PASSES) {
            emit(
              `\n\n⚠ Integrity validation found ${errors.length} fabricated data point(s) — regenerating with corrections…\n\n`
            );
          } else {
            emit(
              `\n\n⚠ ${errors.length} integrity violation(s) remain after retry — report will be flagged.\n\n`
            );
          }
        }

        if (!result?.ok) return;
        const fullOutput = result.output;
        const generatedBy = result.generatedBy;

        try {
          const normTicker = asxTicker.replace(".AX", "").replace(/\s+/g, "_");
          const dir = path.join(PROJECT_ROOT, "web", "reports", normTicker);
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${today()}.md`);

          // Force the frontmatter ticker to the canonical one before saving, so
          // the file, DB row and page heading all agree even if the model drifted
          // (emitting "XAU" instead of "GOLD") or omitted the ticker entirely.
          const extracted = extractReport(fullOutput);
          let reportContent = /^ticker:.*$/m.test(extracted)
            ? extracted.replace(/^ticker:.*$/m, `ticker: ${asxTicker}`)
            : extracted.replace(/^---\n/, `---\nticker: ${asxTicker}\n`);

          // Never write a stub: output without a verdict and an IV range is a
          // failed generation, not a report (a 17-byte file got saved once).
          try {
            const { data: check } = matter(reportContent);
            if (
              check?.verdict == null ||
              (check.intrinsicValueLow == null && check.intrinsicValueHigh == null)
            ) {
              emit(`\n\n__ERROR__:Generated output is not a valid report (missing verdict/intrinsic value) — nothing saved.`);
              return;
            }
          } catch {
            emit(`\n\n__ERROR__:Generated output has unparseable frontmatter — nothing saved.`);
            return;
          }

          // Record which engine actually wrote the report (system-stamped, never
          // left to the LLM — with "auto" the UI's choice isn't the whole story),
          // plus any unresolved integrity violations so they surface in the UI.
          const flagLines = violations.length
            ? `\nintegrityFlags:\n${violations.map((v) => `  - "${v.severity}: ${v.rule}"`).join("\n")}`
            : "";
          reportContent = reportContent
            .replace(/^generatedBy:.*\n?/m, "")
            .replace(/^integrityFlags:\n(?:\s+-.*\n?)*/m, "")
            .replace(/^ticker: .*$/m, (m) => `${m}\ngeneratedBy: ${generatedBy}${flagLines}`);

          // Layer 3: the technical-analysis section's readings table is
          // rendered in code and spliced in — the LLM never writes those
          // numbers (its prose interpretation stays, below the table).
          if (type === "stock" && technicalsReading) {
            reportContent = spliceTechnicalsTable(
              reportContent,
              formatTechnicalsTableMarkdown(technicalsReading, priceCurrency)
            );
          }

          // Stamp code-authoritative valuation fields into the frontmatter so the
          // model IV, version and divergence are recorded by the system (not left
          // to the LLM to copy). Compute divergence vs the LLM's reconciled IV.
          if (valuation) {
            const { data: fm } = matter(reportContent);
            const llmLow = typeof fm.intrinsicValueLow === "number" ? fm.intrinsicValueLow : null;
            const llmHigh = typeof fm.intrinsicValueHigh === "number" ? fm.intrinsicValueHigh : null;
            const llmFair = llmLow != null && llmHigh != null ? (llmLow + llmHigh) / 2 : llmHigh ?? llmLow;
            const divergencePct =
              llmFair != null && valuation.codeFairValue > 0
                ? ((llmFair - valuation.codeFairValue) / valuation.codeFairValue) * 100
                : null;

            const stamp = [
              `modelVersion: ${valuation.modelVersion}`,
              `modelIntrinsicValueLow: ${valuation.codeIvLow.toFixed(2)}`,
              `modelIntrinsicValueHigh: ${valuation.codeIvHigh.toFixed(2)}`,
              `modelFairValue: ${valuation.codeFairValue.toFixed(2)}`,
              codeThresholds ? `modelBuyBelow: ${codeThresholds.buyBelow.toFixed(2)}` : null,
              codeThresholds ? `modelSellAbove: ${codeThresholds.sellAbove.toFixed(2)}` : null,
              divergencePct != null ? `valuationDivergencePct: ${divergencePct.toFixed(1)}` : null,
            ].filter(Boolean).join("\n");
            // Replace any model* lines the LLM may have emitted, then insert ours.
            reportContent = reportContent
              .replace(/^(modelVersion|modelIntrinsicValueLow|modelIntrinsicValueHigh|modelFairValue|modelBuyBelow|modelSellAbove|valuationDivergencePct):.*$/gm, "")
              .replace(/\n{3,}/g, "\n\n")
              .replace(/^ticker: .*$/m, (m) => `${m}\n${stamp}`);

            try {
              saveValuationSidecar(asxTicker, today(), {
                model: valuation,
                llm: {
                  intrinsicValueLow: llmLow,
                  intrinsicValueHigh: llmHigh,
                  fairValue: llmFair,
                  consensusBuyBelow: typeof fm.consensusBuyBelow === "number" ? fm.consensusBuyBelow : null,
                  consensusSellAbove: typeof fm.consensusSellAbove === "number" ? fm.consensusSellAbove : null,
                },
                dbThresholds: codeThresholds,
                divergencePct,
                savedAt: new Date().toISOString(),
              });
            } catch (e) {
              console.error("[valuation] sidecar save failed:", e);
            }
          }

          fs.writeFileSync(filePath, reportContent.trim(), "utf-8");
          saveReportToDB(asxTicker, filePath, reportContent, codeThresholds, type === "stock", generatedBy, livePrice);

          const redirectPath = `/research/${encodeURIComponent(asxTicker)}`;
          emit(`\n\n__DONE__:${JSON.stringify({ path: redirectPath })}`);
        } catch (saveErr) {
          console.error("[generate] save failed:", saveErr);
          emit(`\n\n__ERROR__:Report generated but could not save: ${saveErr}`);
        }
      })()
        .catch((e) => {
          console.error("[generate] unexpected failure:", e);
          emit(`\n\n__ERROR__:${e instanceof Error ? e.message : String(e)}`);
        })
        .finally(() => {
          clearInterval(heartbeat);
          close();
        });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-cache",
    },
  });
}
