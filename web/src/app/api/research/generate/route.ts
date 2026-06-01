/**
 * Research report generation via the local Claude Code CLI.
 * Spawns `claude -p "..."` in the project root so the Buffett skill,
 * reference files and CLAUDE.md are all loaded automatically — no separate
 * API key required. Uses the same Claude account as this Claude Code session.
 */
import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";

export const maxDuration = 300; // 5-minute timeout

// The claude CLI lives alongside the IDE extension on this machine.
const CLAUDE_BINARY =
  "/Users/christophermccallum/.antigravity-ide/extensions/anthropic.claude-code-2.1.156-darwin-arm64/resources/native-binary/claude";

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

  if (type === "stock") {
    return `Analyse ASX:${ticker}${name ? ` — ${name}` : ""} as Warren Buffett would.

Generate a comprehensive investment research report following the full analysis format in CLAUDE.md. Include all 17 sections (Part A sections 1–8 and Part B sections 9–17). Start the output with the YAML frontmatter block (between --- markers).

Today's date: ${date}

Output ONLY the complete markdown report. Do not include any preamble or commentary outside the report itself. After generating the full report, save it to web/reports/${ticker.replace(".AX", "")}/\${date}.md using the Write tool.`;
  }

  return `Analyse ${label} as a physical ${type} investment.

Generate a comprehensive research report using the commodity analysis framework from COMMODITIES.md. Adapt all 17 sections to the commodity context — replace equity-focused sections with their commodity equivalents (supply/demand, cost curve, incentive price, etc.). Start the output with the YAML frontmatter block (between --- markers) — set intrinsicValueLow/High to the incentive price range.

Today's date: ${date}

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

      // stream-json emits newline-delimited JSON; extract text tokens as they arrive
      let jsonBuf = "";
      child.stdout.on("data", (chunk: Buffer) => {
        jsonBuf += chunk.toString();
        const lines = jsonBuf.split("\n");
        jsonBuf = lines.pop() ?? ""; // keep incomplete trailing line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            // Assistant text delta
            if (event.type === "assistant") {
              for (const block of event.message?.content ?? []) {
                if (block.type === "text" && block.text) {
                  fullOutput += block.text;
                  controller.enqueue(encoder.encode(block.text));
                }
              }
            }
            // Final result carries the complete text too — use as fallback
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
        // Forward stderr as a comment so it's visible but doesn't break parsing
        const text = chunk.toString();
        console.error("[claude stderr]", text);
      });

      child.on("error", (err) => {
        controller.enqueue(
          encoder.encode(`\n\n__ERROR__:Failed to start Claude CLI: ${err.message}`)
        );
        controller.close();
      });

      child.on("close", (code) => {
        if (code !== 0 && fullOutput.trim() === "") {
          controller.enqueue(
            encoder.encode(`\n\n__ERROR__:Claude CLI exited with code ${code}`)
          );
          controller.close();
          return;
        }

        // Try to save the report ourselves as a backup (claude may have already
        // saved it via the Write tool — if so, this will just overwrite with the same content)
        try {
          const normTicker = asxTicker.replace(".AX", "").replace(/\s+/g, "_");
          const dir = path.join(PROJECT_ROOT, "web", "reports", normTicker);
          fs.mkdirSync(dir, { recursive: true });
          const filePath = path.join(dir, `${today()}.md`);

          // Extract the markdown report:
          // 1. Strip anything before the first ---
          // 2. If the CLI wrapped it in a ```markdown code block, unwrap it
          let reportContent = fullOutput;
          const firstDash = fullOutput.indexOf("---");
          if (firstDash !== -1) reportContent = fullOutput.slice(firstDash);

          // Unwrap ```markdown ... ``` wrapper the CLI sometimes adds
          const codeBlockMatch = reportContent.match(/^---\s*\n```(?:markdown)?\n([\s\S]*?)```[\s\S]*$/);
          if (codeBlockMatch) {
            reportContent = codeBlockMatch[1].trim();
          } else {
            // Strip trailing ``` and any CLI narration after the last ```
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
