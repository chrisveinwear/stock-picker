/**
 * Refresh rotation queue.
 *
 * Builds a single de-duplicated list of "things we research" — watch-list names,
 * portfolio holdings, and physical metals — and decides which are *due* for a
 * fresh research report. Staleness is measured purely from the latest row in
 * `research_reports` for each ticker (the report date is the source of truth, so
 * no extra schema/migration is needed).
 *
 * Rotation strategy: refresh the most-stale targets first, a few per day, so the
 * whole list cycles within a month with no manual action. `minAgeDays` stops a
 * small list from being needlessly regenerated every few days.
 */
import { getDb } from "@/db";
import { watchlist, portfolioHoldings, researchReports } from "@/db/schema";
import { getMetalPositions } from "@/lib/metals";
import { isMetalTicker } from "@/lib/metal-tickers";
import { desc } from "drizzle-orm";

export type RefreshType = "stock" | "metal" | "commodity";

export type RefreshTarget = {
  ticker: string; // canonical research ticker — ".AX" for equities, bare for metals
  type: RefreshType;
  name: string | null;
  source: ("watchlist" | "portfolio" | "metals")[];
  lastReportDate: string | null; // ISO "YYYY-MM-DD" of latest report, or null if never
  ageDays: number | null; // days since lastReportDate, or null if never researched
};

/** Target the whole list to refresh within ~28 days. */
const MONTHLY_WINDOW_DAYS = 28;
/** Don't regenerate a report younger than this (keeps small lists from over-refreshing). */
export const DEFAULT_MIN_AGE_DAYS = 25;

/** Normalise an equity ticker to the canonical ".AX" form used in research_reports. */
function normaliseEquityTicker(raw: string): string {
  const t = raw.trim().toUpperCase();
  return t.includes(".") ? t : `${t}.AX`;
}

/**
 * Heuristic for "is this an ASX-listed equity we can actually research".
 * Excludes managed funds / APIR codes (e.g. FSF0581AU) that aren't on Yahoo and
 * can't be run through the equity analysis pipeline.
 */
function isResearchableEquity(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  if (t.endsWith(".AX")) return true;
  // 1-5 letter codes with no digits are treated as ASX tickers (we'll add .AX).
  return /^[A-Z]{1,5}$/.test(t);
}

function daysSince(isoDate: string | null): number | null {
  if (!isoDate) return null;
  const then = new Date(`${isoDate}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((Date.now() - then) / (24 * 60 * 60 * 1000));
}

/** Latest report date per ticker, from research_reports. */
function latestReportDates(): Record<string, string> {
  const db = getDb();
  const rows = db
    .select({ ticker: researchReports.ticker, reportDate: researchReports.reportDate })
    .from(researchReports)
    .orderBy(desc(researchReports.reportDate))
    .all();
  const map: Record<string, string> = {};
  for (const r of rows) {
    if (!(r.ticker in map)) map[r.ticker] = r.reportDate; // first seen = most recent
  }
  return map;
}

/**
 * Build the full, de-duplicated list of refresh targets across watch list,
 * portfolio and metals, annotated with how stale each one's latest report is.
 * Sorted most-stale first (never-researched at the top).
 */
export function buildRefreshTargets(): RefreshTarget[] {
  const db = getDb();
  const latest = latestReportDates();

  const byTicker = new Map<string, RefreshTarget>();

  const upsert = (
    ticker: string,
    type: RefreshType,
    name: string | null,
    source: RefreshTarget["source"][number]
  ) => {
    const existing = byTicker.get(ticker);
    if (existing) {
      if (!existing.source.includes(source)) existing.source.push(source);
      if (!existing.name && name) existing.name = name;
      return;
    }
    const last = latest[ticker] ?? null;
    byTicker.set(ticker, {
      ticker,
      type,
      name,
      source: [source],
      lastReportDate: last,
      ageDays: daysSince(last),
    });
  };

  // Watch list (equities — except legacy metal rows like "GOLD", which must
  // refresh as commodities, not as the GOLD.AX ETF)
  for (const w of db.select().from(watchlist).all()) {
    if (isMetalTicker(w.ticker)) {
      upsert(w.ticker.trim().toUpperCase(), "metal", w.companyName ?? null, "watchlist");
      continue;
    }
    if (!isResearchableEquity(w.ticker)) continue;
    upsert(normaliseEquityTicker(w.ticker), "stock", w.companyName ?? null, "watchlist");
  }

  // Portfolio holdings (equities) — dedupe across accounts via the ticker key
  for (const h of db.select().from(portfolioHoldings).all()) {
    if (isMetalTicker(h.ticker)) {
      upsert(h.ticker.trim().toUpperCase(), "metal", h.companyName ?? null, "portfolio");
      continue;
    }
    if (!isResearchableEquity(h.ticker)) continue;
    upsert(normaliseEquityTicker(h.ticker), "stock", h.companyName ?? null, "portfolio");
  }

  // Physical metals → bare upper-case ticker (matches reports like GOLD)
  for (const m of getMetalPositions(db)) {
    const ticker = m.metal.trim().toUpperCase();
    upsert(ticker, "metal", m.label ?? null, "metals");
  }

  return [...byTicker.values()].sort((a, b) => {
    // Never-researched first; then oldest report first.
    if (a.lastReportDate === null && b.lastReportDate !== null) return -1;
    if (b.lastReportDate === null && a.lastReportDate !== null) return 1;
    if (a.lastReportDate === null && b.lastReportDate === null) {
      return a.ticker.localeCompare(b.ticker);
    }
    return (a.lastReportDate ?? "").localeCompare(b.lastReportDate ?? "");
  });
}

/** How many to refresh per day so the whole list cycles within the monthly window. */
export function dailyQuota(total: number): number {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total / MONTHLY_WINDOW_DAYS));
}

export type DueSelection = {
  targets: RefreshTarget[]; // the ones to refresh now
  total: number; // total targets tracked
  quota: number; // how many per day
  dueCount: number; // how many are currently past minAge (the backlog)
};

/**
 * Select the targets to refresh in this run: the most-stale ones whose latest
 * report is older than `minAgeDays` (or never produced), capped at the daily quota.
 */
export function selectDueTargets(opts?: {
  perDay?: number;
  minAgeDays?: number;
}): DueSelection {
  const minAgeDays = opts?.minAgeDays ?? DEFAULT_MIN_AGE_DAYS;
  const all = buildRefreshTargets();
  const quota = opts?.perDay ?? dailyQuota(all.length);

  const due = all.filter((t) => t.ageDays === null || t.ageDays >= minAgeDays);

  return {
    targets: due.slice(0, quota),
    total: all.length,
    quota,
    dueCount: due.length,
  };
}
