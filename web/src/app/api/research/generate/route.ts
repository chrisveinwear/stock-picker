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
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";

export const maxDuration = 300;

const CLAUDE_BINARY =
  "/Users/christophermccallum/Library/Application Support/Claude/claude-code/2.1.181/claude.app/Contents/MacOS/claude";

const PROJECT_ROOT = path.join(process.cwd(), "..");

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function buildPrompt(
  ticker: string,
  type: "stock" | "metal" | "commodity",
  name?: string
): string {
  const date = today();
  const label = name ? `${ticker} (${name})` : ticker;

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

  if (type === "stock") {
    return `Analyse ASX:${ticker}${name ? ` — ${name}` : ""} as Warren Buffett would.

Generate a comprehensive investment research report following the full analysis format in CLAUDE.md. Include all 17 sections (Part A sections 1–8 and Part B sections 9–17). Start the output with the YAML frontmatter block (between --- markers).

Today's date: ${date}

${priceLensesInstruction}

Output ONLY the complete markdown report. Do not include any preamble or commentary outside the report itself. After generating the full report, save it to web/reports/${ticker.replace(".AX", "")}/\${date}.md using the Write tool.`;
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

  return `Analyse ${label} as a physical ${type} investment.

Generate a comprehensive research report using the commodity analysis framework from COMMODITIES.md. Adapt all 17 sections to the commodity context — replace equity-focused sections with their commodity equivalents (supply/demand, cost curve, incentive price, etc.). Start the output with the YAML frontmatter block (between --- markers) — set intrinsicValueLow/High to the incentive price range.

Today's date: ${date}

${commodityLensesInstruction}

Output ONLY the complete markdown report. Do not include any preamble or commentary outside the report itself. After generating the full report, save it to web/reports/${ticker.replace(/\s+/g, "_").toUpperCase()}/\${date}.md using the Write tool.`;
}

function saveReportToDB(ticker: string, filePath: string, content: string) {
  try {
    const { data } = matter(content);
    const db = getDb();
    const finalTicker = data.ticker ?? ticker;
    const reportDate = data.reportDate ?? today();

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
  } catch (e) {
    console.error("DB save error:", e);
  }
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

  const prompt = buildPrompt(asxTicker, type, name?.trim());
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

          let reportContent = fullOutput;
          const firstDash = fullOutput.indexOf("---");
          if (firstDash !== -1) reportContent = fullOutput.slice(firstDash);

          const codeBlockMatch = reportContent.match(/^---\s*\n```(?:markdown)?\n([\s\S]*?)```[\s\S]*$/);
          if (codeBlockMatch) {
            reportContent = codeBlockMatch[1].trim();
          } else {
            const lastCodeFence = reportContent.lastIndexOf("\n```");
            if (lastCodeFence !== -1 && !reportContent.slice(lastCodeFence + 4).trim().startsWith("\n#")) {
              reportContent = reportContent.slice(0, lastCodeFence).trim();
            }
          }

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
