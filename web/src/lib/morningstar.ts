/**
 * Morningstar reference data — import + access.
 *
 * The user has a personal Morningstar subscription but no API entitlement (Direct
 * Web Services is an enterprise product). So the data is exported by hand from
 * Morningstar (a portfolio CSV) and uploaded here periodically.
 *
 * The parser is deliberately TOLERANT: the export's column set, order, header
 * labels and even the row the table starts on can all change between versions.
 * We therefore detect columns by fuzzy-matching header text rather than by fixed
 * position, find the header row dynamically, and skip any row we can't confidently
 * parse instead of throwing. The only hard requirement is that we can recover a
 * ticker and at least one useful datapoint (moat or price/fair-value).
 */

import { getDb } from "@/db";
import { morningstarData } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export type MoatRating = "None" | "Narrow" | "Wide";

export interface ParsedMorningstarRow {
  ticker: string;          // normalised, e.g. "CSL.AX"
  holdingName: string;     // raw name cell
  economicMoat: MoatRating | null;
  priceToFairValue: number | null;
  /** Dollar fair-value estimate, when the sheet gives that instead of a ratio.
   *  Not persisted directly — the API route derives priceToFairValue from it
   *  using the live price before saving. */
  fairValue: number | null;
  starRating: number | null;
  uncertainty: string | null;
  capitalAllocation: string | null;
}

export interface ParseResult {
  rows: ParsedMorningstarRow[];
  skipped: { raw: string; reason: string }[];
  detectedColumns: Record<string, number>; // concept -> column index (for transparency)
  asOfDate: string;                          // ISO date the snapshot reflects
}

/* ------------------------------------------------------------------ */
/* CSV parsing (RFC-4180-ish, no dependency)                          */
/* ------------------------------------------------------------------ */

/** Parse a single CSV line into cells, honouring quotes and escaped quotes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/* ------------------------------------------------------------------ */
/* Fuzzy header detection                                             */
/* ------------------------------------------------------------------ */

// Each concept maps to a list of substrings; the first header cell whose
// normalised text contains any of them claims that concept. Order matters:
// more specific concepts are matched first so "price/fair value" isn't stolen
// by a bare "fair value" rule, etc.
const COLUMN_MATCHERS: { concept: string; needles: string[] }[] = [
  { concept: "symbol", needles: ["symbol", "ticker", "code"] },
  { concept: "name", needles: ["holding name", "holding", "name", "security", "investment"] },
  { concept: "moat", needles: ["economic moat", "moat"] },
  { concept: "pfv", needles: ["price/fair value", "price / fair value", "price/fair", "p/fv", "pfv", "price to fair"] },
  // Must come after "pfv": a "Price/Fair Value" header also contains the
  // substring "fair value", so detectHeader's claimed-column tracking is what
  // stops this from also grabbing that same column.
  { concept: "fv", needles: ["fair value estimate", "fair value ($)", "fair value"] },
  { concept: "star", needles: ["morningstar rating", "star rating", "rating"] },
  { concept: "uncertainty", needles: ["uncertainty", "fair value uncertainty"] },
  { concept: "capital", needles: ["capital allocation", "stewardship"] },
];

/**
 * Columns for the downloadable import template (see /api/morningstar/template).
 * Every header here MUST be matched by a COLUMN_MATCHERS needle above, so a
 * filled-in template always round-trips through the parser.
 */
export const MORNINGSTAR_TEMPLATE_COLUMNS: {
  header: string;
  concept: string;
  guidance: string;
  example: string;
}[] = [
  { header: "Symbol", concept: "symbol", guidance: "ASX code, with or without .AX (e.g. CSL or CSL.AX)", example: "CSL" },
  { header: "Holding Name", concept: "name", guidance: "Company name (free text)", example: "CSL Limited" },
  { header: "Economic Moat", concept: "moat", guidance: "Wide, Narrow or None", example: "Wide" },
  { header: "Fair Value", concept: "fv", guidance: "Dollar fair-value estimate (e.g. 24.50) — NOT a ratio. The app converts this to a Price/Fair Value ratio automatically using the live market price.", example: "24.50" },
  { header: "Morningstar Rating", concept: "star", guidance: "Stars 1–5 (a number, e.g. 4)", example: "4" },
  { header: "Fair Value Uncertainty", concept: "uncertainty", guidance: "Low, Medium, High, Very High or Extreme", example: "Medium" },
  { header: "Capital Allocation", concept: "capital", guidance: "Exemplary, Standard or Poor", example: "Exemplary" },
];

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Find the header row index + a concept->column map. Returns null if no header. */
function detectHeader(rows: string[][]): { headerIdx: number; cols: Record<string, number> } | null {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = rows[r].map(norm);
    const cols: Record<string, number> = {};
    const claimed = new Set<number>();
    for (const { concept, needles } of COLUMN_MATCHERS) {
      if (concept in cols) continue;
      const idx = cells.findIndex((c, i) => !claimed.has(i) && c && needles.some((n) => c.includes(n)));
      if (idx >= 0) {
        cols[concept] = idx;
        claimed.add(idx);
      }
    }
    // A valid header must let us identify the row (name or symbol) AND carry at
    // least one Morningstar datapoint (moat, price/fair-value, or fair value).
    const canIdentify = "name" in cols || "symbol" in cols;
    const hasData = "moat" in cols || "pfv" in cols || "fv" in cols;
    if (canIdentify && hasData) return { headerIdx: r, cols };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Value normalisers                                                  */
/* ------------------------------------------------------------------ */

const EMPTY = new Set(["", "-", "—", "–", "n/a", "na", "null"]);
const isEmpty = (s: string | undefined) => s == null || EMPTY.has(norm(s));

function normMoat(s: string | undefined): MoatRating | null {
  if (isEmpty(s)) return null;
  const v = norm(s!);
  if (v.startsWith("wide")) return "Wide";
  if (v.startsWith("narrow")) return "Narrow";
  if (v.startsWith("none") || v === "no" || v === "no moat") return "None";
  return null;
}

function normNumber(s: string | undefined): number | null {
  if (isEmpty(s)) return null;
  const n = parseFloat(s!.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normStar(s: string | undefined): number | null {
  if (isEmpty(s)) return null;
  // Accept "4", "4 stars", or a run of ★ characters.
  const stars = (s!.match(/★/g) || []).length;
  if (stars >= 1 && stars <= 5) return stars;
  const n = normNumber(s);
  return n != null && n >= 1 && n <= 5 ? Math.round(n) : null;
}

/**
 * Recover a tradeable ASX ticker. Prefer an explicit symbol cell; otherwise take
 * the last whitespace token of the name (Morningstar appends the code, e.g.
 * "Csl Limited CSL"). Reject obvious non-tickers (APIR fund codes appended without
 * a space, long mixed-case blobs). ASX equity codes are 1–4 uppercase alphanumerics.
 */
function extractTicker(symbolCell: string | undefined, nameCell: string): string | null {
  const candidates: string[] = [];
  if (!isEmpty(symbolCell)) candidates.push(symbolCell!.trim());
  const tokens = nameCell.trim().split(/\s+/);
  if (tokens.length) candidates.push(tokens[tokens.length - 1]);

  for (const c of candidates) {
    const raw = c.replace(/\.(ax|asx)$/i, "").toUpperCase();
    // 1–5 chars, all A–Z/0–9, contains at least one letter, not purely numeric.
    if (/^[A-Z0-9]{1,5}$/.test(raw) && /[A-Z]/.test(raw)) {
      return raw.includes(".") ? raw : `${raw}.AX`;
    }
  }
  return null;
}

/** Pull an ISO date out of a filename like "Morningstar portfolio 20260628.csv". */
export function dateFromFilename(filename: string | undefined): string | null {
  if (!filename) return null;
  // YYYY-MM-DD or YYYYMMDD anywhere in the name.
  const m = filename.match(/(20\d{2})[-_]?(\d{2})[-_]?(\d{2})/);
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}`;
    if (!Number.isNaN(Date.parse(iso))) return iso;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Public: parse                                                      */
/* ------------------------------------------------------------------ */

export function parseMorningstarCsv(text: string, opts?: { asOf?: string; filename?: string }): ParseResult {
  const asOfDate =
    opts?.asOf ||
    dateFromFilename(opts?.filename) ||
    new Date().toISOString().slice(0, 10);

  // Strip BOM, split lines, drop blank lines.
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  const grid = lines.map(parseCsvLine);

  const header = detectHeader(grid);
  if (!header) {
    return {
      rows: [],
      skipped: [{ raw: lines[0] ?? "", reason: "no recognisable header row (need a name/symbol column plus moat or price/fair-value)" }],
      detectedColumns: {},
      asOfDate,
    };
  }

  const { headerIdx, cols } = header;
  const at = (cells: string[], concept: string) =>
    concept in cols ? cells[cols[concept]] : undefined;

  const rows: ParsedMorningstarRow[] = [];
  const skipped: ParseResult["skipped"] = [];

  for (let r = headerIdx + 1; r < grid.length; r++) {
    const cells = grid[r];
    const nameCell = at(cells, "name") ?? "";
    const symbolCell = at(cells, "symbol");
    const raw = cells.join(",");

    if (isEmpty(nameCell) && isEmpty(symbolCell)) continue; // spacer row

    const ticker = extractTicker(symbolCell, nameCell);
    if (!ticker) {
      skipped.push({ raw, reason: `could not derive an ASX ticker from "${nameCell || symbolCell}"` });
      continue;
    }

    const moat = normMoat(at(cells, "moat"));
    const pfv = normNumber(at(cells, "pfv"));
    const fairValue = normNumber(at(cells, "fv"));
    // Skip rows with no Morningstar coverage at all (ETFs / funds / not-covered).
    if (moat == null && pfv == null && fairValue == null) {
      skipped.push({ raw, reason: `${ticker}: no moat, price/fair-value, or fair value (not covered)` });
      continue;
    }

    rows.push({
      ticker,
      holdingName: nameCell || ticker,
      economicMoat: moat,
      priceToFairValue: pfv,
      fairValue,
      starRating: normStar(at(cells, "star")),
      uncertainty: isEmpty(at(cells, "uncertainty")) ? null : at(cells, "uncertainty")!.trim(),
      capitalAllocation: isEmpty(at(cells, "capital")) ? null : at(cells, "capital")!.trim(),
    });
  }

  return { rows, skipped, detectedColumns: cols, asOfDate };
}

/* ------------------------------------------------------------------ */
/* Public: persistence                                                */
/* ------------------------------------------------------------------ */

/** Upsert parsed rows as a dated snapshot. Returns count written. */
export function saveMorningstarRows(rows: ParsedMorningstarRow[], asOfDate: string): number {
  const db = getDb();
  const importedAt = new Date().toISOString();
  let n = 0;
  for (const row of rows) {
    // fairValue (dollar) is a parse-time intermediate only — by the time this
    // runs the API route has derived priceToFairValue from it, so it's
    // deliberately excluded from what gets persisted.
    const values = {
      ticker: row.ticker,
      holdingName: row.holdingName,
      economicMoat: row.economicMoat,
      priceToFairValue: row.priceToFairValue,
      starRating: row.starRating,
      uncertainty: row.uncertainty,
      capitalAllocation: row.capitalAllocation,
      asOfDate,
      importedAt,
    };
    db.insert(morningstarData)
      .values(values)
      .onConflictDoUpdate({
        target: [morningstarData.ticker, morningstarData.asOfDate],
        set: values,
      })
      .run();
    n++;
  }
  return n;
}

export type MorningstarSnapshot = typeof morningstarData.$inferSelect;

/** Latest snapshot for a ticker (most recent asOfDate), or null. */
export function getMorningstar(ticker: string): MorningstarSnapshot | null {
  const db = getDb();
  const t = ticker.toUpperCase();
  const row = db
    .select()
    .from(morningstarData)
    .where(eq(morningstarData.ticker, t))
    .orderBy(desc(morningstarData.asOfDate))
    .limit(1)
    .get();
  return row ?? null;
}

/** All tickers' latest snapshots (for a dashboard/list view). */
export function getAllLatestMorningstar(): MorningstarSnapshot[] {
  const db = getDb();
  const all = db.select().from(morningstarData).orderBy(desc(morningstarData.asOfDate)).all();
  const seen = new Set<string>();
  const latest: MorningstarSnapshot[] = [];
  for (const r of all) {
    if (seen.has(r.ticker)) continue;
    seen.add(r.ticker);
    latest.push(r);
  }
  return latest.sort((a, b) => (a.priceToFairValue ?? 99) - (b.priceToFairValue ?? 99));
}

/* ------------------------------------------------------------------ */
/* Public: report prompt formatting                                   */
/* ------------------------------------------------------------------ */

/**
 * Build the Morningstar lens block for a research-report prompt, or "" if we have
 * no data for the ticker. Price/Fair-Value is converted to a discount/premium and,
 * when a live price is supplied, an implied fair value.
 */
export function formatMorningstarForPrompt(ticker: string, currentPrice?: number | null): string {
  const m = getMorningstar(ticker);
  if (!m) return "";

  const parts: string[] = [];
  if (m.economicMoat) parts.push(`Economic Moat: **${m.economicMoat}**`);
  if (m.priceToFairValue != null) {
    const pct = (1 - m.priceToFairValue) * 100;
    const verb = pct >= 0 ? "discount to" : "premium to";
    parts.push(
      `Price/Fair Value: **${m.priceToFairValue.toFixed(2)}** (${Math.abs(pct).toFixed(0)}% ${verb} Morningstar fair value)`
    );
    if (currentPrice && currentPrice > 0 && m.priceToFairValue > 0) {
      const impliedFv = currentPrice / m.priceToFairValue;
      parts.push(`Implied Morningstar fair value ≈ ${impliedFv.toFixed(2)} (live price ${currentPrice.toFixed(2)} ÷ P/FV)`);
    }
  }
  if (m.starRating != null) parts.push(`Star Rating: ${m.starRating}★`);
  if (m.uncertainty) parts.push(`Uncertainty: ${m.uncertainty}`);
  if (m.capitalAllocation) parts.push(`Capital Allocation: ${m.capitalAllocation}`);

  return `\n\n## Morningstar (manual import — as of ${m.asOfDate})\n\nMorningstar's own ratings for this stock, imported from the user's subscription. Treat this as an INDEPENDENT external cross-check against the code valuation engine and the institutional lenses — do not blend it into your own intrinsic-value math, but DO reconcile against it: if your fair value and Morningstar's differ materially, say why.\n\n- ${parts.join("\n- ")}\n\nWhen you build the priceLenses array, include a "Morningstar" lens: set fairValue to Morningstar's implied fair value (live price ÷ Price/Fair Value), and set buyBelow / sellAbove using Morningstar's uncertainty band if known (otherwise a sensible margin around the fair value).`;
}
