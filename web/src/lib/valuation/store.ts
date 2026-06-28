/**
 * Valuation sidecar persistence. Each report gets an immutable audit artefact at
 * reports/[TICKER]/[DATE].valuation.json holding the code model result (inputs,
 * assumptions, methods, IV) plus the LLM's reconciled IV and the divergence.
 * Mirrors the existing markdown-file pattern — no DB migration for the result.
 */
import fs from "fs";
import path from "path";
import type { ValuationResult } from "./index";

const REPORTS_DIR = path.join(process.cwd(), "reports");

export type ValuationSidecar = {
  model: ValuationResult;
  llm?: {
    intrinsicValueLow: number | null;
    intrinsicValueHigh: number | null;
    fairValue: number | null;
  };
  divergencePct: number | null; // (llm fair value vs code fair value)
  savedAt: string;
};

function sidecarPath(ticker: string, date: string): string {
  const normTicker = ticker.replace(".AX", "").replace(/\s+/g, "_").toUpperCase();
  return path.join(REPORTS_DIR, normTicker, `${date}.valuation.json`);
}

export function saveValuationSidecar(
  ticker: string,
  date: string,
  data: ValuationSidecar
): string {
  const p = sidecarPath(ticker, date);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
  return p;
}

export function readValuationSidecar(ticker: string, date: string): ValuationSidecar | null {
  try {
    const p = sidecarPath(ticker, date);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ValuationSidecar;
  } catch {
    return null;
  }
}
