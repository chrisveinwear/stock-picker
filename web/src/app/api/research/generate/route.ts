/**
 * Research report generation via the Claude Code CLI subprocess.
 * Requires the CLI to be authenticated — run the one-time login command:
 *   "/Users/christophermccallum/Library/Application Support/Claude/claude-code/2.1.181/claude.app/Contents/MacOS/claude" login
 */
import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { and, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports, alertLog } from "@/db/schema";
import { fetchRecentNews, formatNewsForPrompt } from "@/lib/news-fetcher";
import { addReportToWatchlist } from "@/lib/watchlist";
import { getCommodityPriceHistory } from "@/lib/yahoo-finance";
import {
  formatHistoryForPrompt,
  getPreviousReport,
  detectMaterialChange,
} from "@/lib/report-history";

export const maxDuration = 300;

function resolveClaudeBinary(): string {
  // Prefer the symlink on PATH (stays current across updates)
  const onPath = "/Users/christophermccallum/.local/bin/claude";
  if (fs.existsSync(onPath)) return onPath;

  // Fall back to the latest versioned bundle under the Claude app directory
  const base = "/Users/christophermccallum/Library/Application Support/Claude/claude-code";
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const v of versions.reverse()) {
      const candidate = `${base}/${v}/claude.app/Contents/MacOS/claude`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return onPath; // will fail gracefully with "not found" error below
}

const CLAUDE_BINARY = resolveClaudeBinary();

const PROJECT_ROOT = path.join(process.cwd(), "..");

function today(): string {
  return new Date().toISOString().split("T")[0];
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

function buildPrompt(
  ticker: string,
  type: "stock" | "metal" | "commodity",
  name?: string,
  newsContext?: string,
  historyContext?: string,
  spotContext?: string
): string {
  const date = today();
  const label = name ? `${ticker} (${name})` : ticker;
  const historySection = historyContext ?? "";
  const spotSection = spotContext ?? "";

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
    sellAbove: <number>
consensusBuyBelow: <number — weighted consensus of all lens buyBelow values; this is the AI recommended maximum buy price>
consensusSellAbove: <number — weighted consensus of all lens sellAbove values; this is the AI recommended minimum sell price>`;

  const newsSection = newsContext ? `\n\n## Live Market Context\n\nThe following recent news and ASX announcements were fetched immediately before generating this report. Use them to inform current sentiment, recent events, and any catalyst or risk sections:\n\n${newsContext}` : "";

  if (type === "stock") {
    return `Analyse ASX:${ticker}${name ? ` — ${name}` : ""} as Warren Buffett would.

Generate a comprehensive investment research report following the full analysis format in CLAUDE.md. Include all 17 sections (Part A sections 1–8 and Part B sections 9–17). Start the output with the YAML frontmatter block (between --- markers).

Today's date: ${date}
${newsSection}
${historySection}

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
${spotSection}
${commodityNewsSection}
${historySection}

${commodityLensesInstruction}

Output ONLY the complete markdown report, beginning directly with the YAML frontmatter block delimited by --- lines. Do NOT wrap the frontmatter or any part of the report in code fences (no \`\`\`yaml or \`\`\`markdown). Do NOT use any tools and do NOT save the file yourself — just print the raw markdown report to stdout. No preamble or commentary outside the report.`;
}

function saveReportToDB(ticker: string, filePath: string, content: string) {
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

    db.insert(researchReports)
      .values({
        ticker: finalTicker,
        companyName: data.companyName ?? data.company ?? null,
        reportDate,
        verdict: data.verdict ?? null,
        intrinsicValueLow: data.intrinsicValueLow ?? null,
        intrinsicValueHigh: data.intrinsicValueHigh ?? null,
        marginOfSafety: data.marginOfSafety ?? null,
        buyBelow: data.consensusBuyBelow ?? null,
        sellAbove: data.consensusSellAbove ?? null,
        filePath,
        generatedBy: "claude-code",
      })
      .run();

    // Automatically add the researched stock to the watch list (idempotent).
    addReportToWatchlist({
      ticker: finalTicker,
      companyName: data.companyName ?? data.company ?? null,
      intrinsicValueLow: data.intrinsicValueLow ?? null,
      intrinsicValueHigh: data.intrinsicValueHigh ?? null,
      buyBelow: data.consensusBuyBelow ?? null,
    });

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
  let text = raw.replace(/```ya?ml\s*\n(---\n[\s\S]*?\n---)\s*\n```/, "$1");

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
  const { ticker, type, name } = (await req.json()) as {
    ticker: string;
    type: "stock" | "metal" | "commodity";
    name?: string;
  };

  if (!ticker) {
    return new Response(JSON.stringify({ error: "ticker required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!fs.existsSync(CLAUDE_BINARY)) {
    return new Response(
      JSON.stringify({ error: `Claude CLI not found at ${CLAUDE_BINARY}` }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const tickerUpper = ticker.trim().toUpperCase();
  const asxTicker =
    type === "stock" && !tickerUpper.includes(".")
      ? `${tickerUpper}.AX`
      : tickerUpper;

  const newsResult = await fetchRecentNews(asxTicker, name?.trim());
  const newsContext = formatNewsForPrompt(newsResult);
  const historyContext = formatHistoryForPrompt(asxTicker);
  const spotContext = type === "stock" ? "" : await fetchCommoditySpot(asxTicker);
  const prompt = buildPrompt(asxTicker, type, name?.trim(), newsContext, historyContext, spotContext);
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let fullOutput = "";

      const child = spawn(
        CLAUDE_BINARY,
        [
          "--output-format", "stream-json",
          "--verbose",
          "--dangerously-skip-permissions",
          "--print",
          prompt,
        ],
        {
          cwd: PROJECT_ROOT,
          env: { ...process.env, HOME: process.env.HOME ?? "/Users/christophermccallum" },
        }
      );

      let jsonBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        jsonBuf += chunk.toString();
        const lines = jsonBuf.split("\n");
        jsonBuf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === "assistant") {
              for (const block of event.message?.content ?? []) {
                if (block.type === "text" && block.text) {
                  fullOutput += block.text;
                  controller.enqueue(encoder.encode(block.text));
                }
              }
            }
            if (event.type === "result" && event.result) {
              if (fullOutput.trim() === "") {
                fullOutput = event.result;
                controller.enqueue(encoder.encode(event.result));
              }
            }
          } catch {
            // not valid JSON, skip
          }
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        console.error("[claude stderr]", chunk.toString());
      });

      child.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`\n\n__ERROR__:Failed to start Claude CLI: ${err.message}`)
        );
        controller.close();
      });

      child.on("close", (code) => {
        // Detect auth failure
        if (fullOutput.includes("Not logged in") || fullOutput.includes("Please run /login")) {
          controller.enqueue(
            encoder.encode(
              `\n\n__ERROR__:Claude CLI is not authenticated. Run this once in your terminal:\n\n"${CLAUDE_BINARY}" login`
            )
          );
          controller.close();
          return;
        }

        // Detect rate/session limit — otherwise the limit message gets saved as a "report"
        if (/hit your (usage|session) limit|usage limit reached|rate limit/i.test(fullOutput)) {
          const resetMatch = fullOutput.match(/resets?[^\n]*/i);
          const resetHint = resetMatch ? ` (${resetMatch[0].trim()})` : "";
          controller.enqueue(
            encoder.encode(
              `\n\n__ERROR__:Claude CLI usage limit reached${resetHint}. Try again after the limit resets.`
            )
          );
          controller.close();
          return;
        }

        if (code !== 0 && fullOutput.trim() === "") {
          controller.enqueue(
            encoder.encode(`\n\n__ERROR__:Claude CLI exited with code ${code}`)
          );
          controller.close();
          return;
        }

        try {
          const normTicker = asxTicker.replace(".AX", "").replace(/\s+/g, "_");
          const dir = path.join(PROJECT_ROOT, "web", "reports", normTicker);
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${today()}.md`);

          // Force the frontmatter ticker to the canonical one before saving, so
          // the file, DB row and page heading all agree even if the model drifted
          // (emitting "XAU" instead of "GOLD") or omitted the ticker entirely.
          const extracted = extractReport(fullOutput);
          const reportContent = /^ticker:.*$/m.test(extracted)
            ? extracted.replace(/^ticker:.*$/m, `ticker: ${asxTicker}`)
            : extracted.replace(/^---\n/, `---\nticker: ${asxTicker}\n`);

          fs.writeFileSync(filePath, reportContent.trim(), "utf-8");
          saveReportToDB(asxTicker, filePath, reportContent);

          const redirectPath = `/research/${encodeURIComponent(asxTicker)}`;
          controller.enqueue(
            encoder.encode(
              `\n\n__DONE__:${JSON.stringify({ path: redirectPath })}`
            )
          );
        } catch (saveErr) {
          controller.enqueue(
            encoder.encode(
              `\n\n__ERROR__:Report generated but could not save: ${saveErr}`
            )
          );
        }

        controller.close();
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
