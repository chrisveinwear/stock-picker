/**
 * Markdown research report file management.
 * Reports live at: web/reports/[TICKER]/[YYYY-MM-DD].md
 * DB stores metadata; this module handles the file side.
 */
import fs from "fs";
import path from "path";
import matter from "gray-matter";

const REPORTS_DIR = path.join(process.cwd(), "reports");

export type ReportFrontmatter = {
  ticker: string;
  company?: string;
  companyName?: string;
  date?: string;
  reportDate?: string;
  verdict?: "buy" | "watch" | "avoid" | "hold";
  intrinsicValueLow?: number;
  intrinsicValueHigh?: number;
  intrinsicValueLowAUD?: number;
  intrinsicValueHighAUD?: number;
  marginOfSafety?: number;
  // Commodity fields
  commodity?: string;
  spotPrice?: number;
  spotPriceAUD?: number;
  spotPriceBrent?: number;
  spotPriceWTI?: number;
  unit?: string;
  // Price lens data (populated by newer AI-generated reports)
  priceLenses?: { name: string; buyBelow: number; fairValue?: number; sellAbove: number }[];
  consensusBuyBelow?: number;
  consensusSellAbove?: number;
  // Allow any other frontmatter fields
  [key: string]: unknown;
};

export type Report = {
  frontmatter: ReportFrontmatter;
  content: string;
  filePath: string;
};

export function getReportPath(ticker: string, date: string): string {
  const normTicker = ticker.replace(".AX", "").toUpperCase();
  return path.join(REPORTS_DIR, normTicker, `${date}.md`);
}

export function listReports(): { ticker: string; date: string; filePath: string }[] {
  if (!fs.existsSync(REPORTS_DIR)) return [];

  const results: { ticker: string; date: string; filePath: string }[] = [];
  const tickers = fs.readdirSync(REPORTS_DIR).filter((f) =>
    fs.statSync(path.join(REPORTS_DIR, f)).isDirectory()
  );

  for (const tickerDir of tickers) {
    const dir = path.join(REPORTS_DIR, tickerDir);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
    if (!files.length) continue;

    // Read ticker from frontmatter of the latest file; fall back to dir name + .AX (stocks)
    let canonicalTicker: string;
    try {
      const raw = fs.readFileSync(path.join(dir, files[0]), "utf-8");
      const { data } = matter(raw);
      canonicalTicker = typeof data.ticker === "string" && data.ticker.trim()
        ? data.ticker.trim()
        : `${tickerDir}.AX`;
    } catch {
      canonicalTicker = `${tickerDir}.AX`;
    }

    for (const file of files) {
      results.push({
        ticker: canonicalTicker,
        date: file.replace(".md", ""),
        filePath: path.join(dir, file),
      });
    }
  }

  return results.sort((a, b) => b.date.localeCompare(a.date));
}

export function readReport(filePath: string): Report | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);
  // gray-matter auto-parses YAML dates as JS Date objects — stringify them
  const frontmatter = Object.fromEntries(
    Object.entries(data).map(([k, v]) => [k, v instanceof Date ? v.toISOString().split("T")[0] : v])
  ) as ReportFrontmatter;
  return {
    frontmatter,
    content,
    filePath,
  };
}

export function getLatestReport(ticker: string): Report | null {
  const normTicker = ticker.replace(".AX", "").toUpperCase();
  const dir = path.join(REPORTS_DIR, normTicker);
  if (!fs.existsSync(dir)) return null;

  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort().reverse();
  if (!files.length) return null;

  return readReport(path.join(dir, files[0]));
}

export function getReportsByTicker(ticker: string): Report[] {
  const normTicker = ticker.replace(".AX", "").toUpperCase();
  const dir = path.join(REPORTS_DIR, normTicker);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse()
    .map((f) => readReport(path.join(dir, f)))
    .filter(Boolean) as Report[];
}
