/**
 * Portfolio news intelligence — the "what moved my holdings" digest.
 *
 * Per holding we fetch news since the last recorded fetch (gap-proof for users
 * who open the app irregularly), dedupe by URL, then classify ALL new items
 * across every holding in ONE Claude CLI call (sentiment / impact / thesis),
 * and persist to news_items. The dashboard reads the cached classification — no
 * live fetch on page load.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { newsItems, newsFetchState, portfolioHoldings, researchReports, stockPicks } from "@/db/schema";
import { fetchRecentNews } from "@/lib/news-fetcher";
import { classifyNews, classifierAvailable, type ClassifyInput, type NewsClassification } from "@/lib/ai/classifier";

// First run / long absence: never look back further than this.
const MAX_LOOKBACK_DAYS = 30;
// Dashboard window — match the lookback so nothing we fetch is hidden.
const DIGEST_WINDOW_DAYS = 30;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** True if an item is newer than `sinceISO`. Undated/relative dates count as recent. */
function isAfter(publishedAt: string | undefined, sinceISO: string): boolean {
  if (!publishedAt) return true;
  const t = Date.parse(publishedAt);
  if (Number.isNaN(t)) return true; // relative strings ("1 week ago") — keep
  return t >= Date.parse(sinceISO);
}

const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** Unique ASX-listed tickers across all accounts, with a display name. */
export function heldEquityTickers(): { ticker: string; companyName: string | null }[] {
  const db = getDb();
  const holdings = db.select().from(portfolioHoldings).all();
  const seen = new Map<string, string | null>();
  for (const h of holdings) {
    if (!h.ticker.endsWith(".AX")) continue; // skip managed funds / super codes
    if (!seen.has(h.ticker)) seen.set(h.ticker, h.companyName);
  }
  return [...seen.entries()].map(([ticker, companyName]) => ({ ticker, companyName }));
}

/** Short thesis context for the classifier: latest report verdict/IV + any pick thesis. */
function getThesisContext(ticker: string): string {
  const db = getDb();
  const report = db
    .select()
    .from(researchReports)
    .where(eq(researchReports.ticker, ticker))
    .orderBy(desc(researchReports.reportDate))
    .get();
  const pick = db.select().from(stockPicks).where(eq(stockPicks.ticker, ticker)).get();

  const parts: string[] = [];
  if (report?.verdict) {
    const iv =
      report.intrinsicValueLow != null && report.intrinsicValueHigh != null
        ? `, IV ${report.intrinsicValueLow}–${report.intrinsicValueHigh}`
        : "";
    parts.push(`verdict ${report.verdict.toUpperCase()}${iv} (${report.reportDate})`);
  }
  if (pick?.thesis) parts.push(pick.thesis);
  if (pick?.moatType) parts.push(`moat: ${pick.moatType}`);
  return parts.join("; ");
}

export type RefreshResult = { ticker: string; added: number; error: string | null };
export type DigestRunResult = { refreshed: number; added: number; classified: boolean; results: RefreshResult[] };

type NovelItem = { title: string; url: string; publishedAt?: string; summary?: string };
type Collected = {
  ticker: string;
  companyName: string | null;
  prevPointer: string | null;
  advance: boolean;
  novel: NovelItem[];
  error: string | null;
};

/**
 * Refresh news for every held ASX equity: fetch since last fetch, dedupe, then
 * classify all new items in a single CLI call, store, and advance fetch pointers.
 */
export async function buildNewsDigest(): Promise<DigestRunResult> {
  const db = getDb();
  const nowISO = new Date().toISOString();
  const held = heldEquityTickers();

  // 1. Collect novel items per ticker (no classification yet).
  const collected: Collected[] = [];
  for (const { ticker, companyName } of held) {
    const state = db.select().from(newsFetchState).where(eq(newsFetchState.ticker, ticker)).get();
    const floor = isoDaysAgo(MAX_LOOKBACK_DAYS);
    const since = state?.lastFetchedAt && state.lastFetchedAt > floor ? state.lastFetchedAt : floor;

    const entry: Collected = {
      ticker,
      companyName,
      prevPointer: state?.lastFetchedAt ?? null,
      advance: true,
      novel: [],
      error: null,
    };

    try {
      const result = await fetchRecentNews(ticker, companyName ?? undefined);
      if (result.source === "none") {
        entry.advance = false; // total failure — keep pointer, retry next run
        entry.error = result.warning ?? "no news source available";
      } else {
        if (result.warning) entry.error = result.warning;
        const fresh = result.items.filter((it) => isAfter(it.publishedAt, since));
        const existing = new Set(
          db.select({ url: newsItems.url }).from(newsItems).where(eq(newsItems.ticker, ticker)).all().map((r) => r.url)
        );
        entry.novel = fresh
          .filter((it) => it.url && !existing.has(it.url))
          .map((it) => ({ title: it.title, url: it.url!, publishedAt: it.publishedAt, summary: it.summary }));
      }
    } catch (e) {
      entry.advance = false;
      entry.error = (e as Error).message?.slice(0, 200) ?? "fetch error";
    }
    collected.push(entry);
  }

  // 2. Classify all novel items across all holdings in ONE call.
  const flat: ClassifyInput[] = collected.flatMap((c) =>
    c.novel.map((it) => ({ ticker: c.ticker, companyName: c.companyName, title: it.title, summary: it.summary, publishedAt: it.publishedAt }))
  );
  let classifications: NewsClassification[] = [];
  let classified = false;
  let classifyError: string | null = null;
  if (flat.length && classifierAvailable()) {
    const thesisByTicker: Record<string, string> = {};
    for (const c of collected) if (c.novel.length) thesisByTicker[c.ticker] = getThesisContext(c.ticker);
    try {
      classifications = await classifyNews(flat, thesisByTicker);
      classified = true;
    } catch (e) {
      classifyError = (e as Error).message?.slice(0, 150) ?? "classify failed";
    }
  }

  // 3. Store items (unclassified items keep null fields for a future reclassify) + advance pointers.
  let added = 0;
  let flatIdx = 0;
  const results: RefreshResult[] = [];
  for (const c of collected) {
    if (c.novel.length) {
      const rows = c.novel.map((it) => {
        const cls = classifications[flatIdx++];
        return {
          ticker: c.ticker,
          title: it.title,
          url: it.url,
          publishedAt: it.publishedAt ?? null,
          summary: it.summary ?? null,
          sentiment: cls?.sentiment ?? null,
          impact: cls?.impact ?? null,
          thesisFlag: cls?.thesisFlag ?? false,
          thesisNote: cls?.thesisNote ?? null,
          aiSummary: cls?.aiSummary || null,
          fetchedAt: nowISO,
        };
      });
      db.insert(newsItems).values(rows).onConflictDoNothing().run();
      added += rows.length;
    }

    const err = c.error ?? (c.novel.length && !classified ? classifyError ?? "classifier unavailable" : null);
    const pointer = c.advance ? nowISO : c.prevPointer;
    db.insert(newsFetchState)
      .values({ ticker: c.ticker, lastFetchedAt: pointer, lastError: err, updatedAt: nowISO })
      .onConflictDoUpdate({
        target: newsFetchState.ticker,
        set: { lastFetchedAt: pointer, lastError: err, updatedAt: nowISO },
      })
      .run();
    results.push({ ticker: c.ticker, added: c.novel.length, error: err });
  }

  return { refreshed: held.length, added, classified, results };
}

export type DigestItem = {
  id: number;
  title: string;
  url: string | null;
  publishedAt: string | null;
  sentiment: string | null;
  impact: string | null;
  thesisFlag: boolean;
  thesisNote: string | null;
  aiSummary: string | null;
  seen: boolean;
};

export type DigestGroup = {
  ticker: string;
  companyName: string | null;
  items: DigestItem[];
  highImpactCount: number;
  unseenCount: number;
  worstSentiment: "positive" | "neutral" | "negative";
  thesisFlagged: boolean;
};

/** Read the cached digest for held equities: recent items grouped by ticker, ranked by impact. */
export function getPortfolioNewsDigest(opts?: { days?: number; maxPerTicker?: number }): DigestGroup[] {
  const db = getDb();
  const days = opts?.days ?? DIGEST_WINDOW_DAYS;
  const maxPerTicker = opts?.maxPerTicker ?? 5;
  const cutoff = isoDaysAgo(days);

  const held = heldEquityTickers();
  if (!held.length) return [];
  const nameByTicker = new Map(held.map((h) => [h.ticker, h.companyName]));
  const tickers = held.map((h) => h.ticker);

  const rows = db
    .select()
    .from(newsItems)
    .where(inArray(newsItems.ticker, tickers))
    .orderBy(desc(newsItems.publishedAt))
    .all()
    .filter((r) => {
      // Only ISO dates can be compared to the cutoff; relative ("1 month ago") or
      // undated items fall back to fetch time so they aren't wrongly excluded.
      const iso = r.publishedAt && /^\d{4}-\d{2}-\d{2}/.test(r.publishedAt) ? r.publishedAt : null;
      if (iso) return iso >= cutoff;
      return (r.fetchedAt ?? "") >= cutoff;
    });

  const byTicker = new Map<string, DigestItem[]>();
  for (const r of rows) {
    const list = byTicker.get(r.ticker) ?? [];
    list.push({
      id: r.id,
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt,
      sentiment: r.sentiment,
      impact: r.impact,
      thesisFlag: !!r.thesisFlag,
      thesisNote: r.thesisNote,
      aiSummary: r.aiSummary,
      seen: !!r.seen,
    });
    byTicker.set(r.ticker, list);
  }

  const groups: DigestGroup[] = [];
  for (const [ticker, items] of byTicker) {
    items.sort((a, b) => {
      const ir = (IMPACT_RANK[b.impact ?? "low"] ?? 1) - (IMPACT_RANK[a.impact ?? "low"] ?? 1);
      if (ir !== 0) return ir;
      return (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
    });
    const worstSentiment = items.some((i) => i.sentiment === "negative")
      ? "negative"
      : items.some((i) => i.sentiment === "positive")
        ? "positive"
        : "neutral";
    groups.push({
      ticker,
      companyName: nameByTicker.get(ticker) ?? null,
      items: items.slice(0, maxPerTicker),
      highImpactCount: items.filter((i) => i.impact === "high").length,
      unseenCount: items.filter((i) => !i.seen).length,
      worstSentiment,
      thesisFlagged: items.some((i) => i.thesisFlag),
    });
  }

  // Rank holdings: thesis-flagged first, then most high-impact, then most items.
  groups.sort((a, b) => {
    if (a.thesisFlagged !== b.thesisFlagged) return a.thesisFlagged ? -1 : 1;
    if (a.highImpactCount !== b.highImpactCount) return b.highImpactCount - a.highImpactCount;
    return b.items.length - a.items.length;
  });
  return groups;
}

/** Mark news items as seen (all held, or a specific ticker). */
export function markNewsSeen(ticker?: string): number {
  const db = getDb();
  const q = db.update(newsItems).set({ seen: true });
  const res = ticker ? q.where(eq(newsItems.ticker, ticker)).run() : q.where(eq(newsItems.seen, false)).run();
  return res.changes ?? 0;
}

export type MaterialAnnouncement = {
  id: number;
  ticker: string;
  companyName: string | null;
  title: string;
  url: string | null;
  publishedAt: string | null;
  impact: string | null;
  sentiment: string | null;
  thesisFlag: boolean;
  thesisNote: string | null;
  aiSummary: string | null;
};

/**
 * Material announcement alerts: high-impact or thesis-flagged news for held
 * equities that hasn't been acknowledged (seen). These are the price-sensitive
 * items (results, guidance, M&A, dividends…) worth surfacing in Action Alerts.
 */
export function getMaterialAnnouncements(opts?: { days?: number }): MaterialAnnouncement[] {
  const db = getDb();
  const cutoff = isoDaysAgo(opts?.days ?? DIGEST_WINDOW_DAYS);
  const held = heldEquityTickers();
  if (!held.length) return [];
  const nameByTicker = new Map(held.map((h) => [h.ticker, h.companyName]));

  return db
    .select()
    .from(newsItems)
    .where(inArray(newsItems.ticker, held.map((h) => h.ticker)))
    .orderBy(desc(newsItems.publishedAt))
    .all()
    .filter((r) => {
      if (r.seen) return false;
      if (r.impact !== "high" && !r.thesisFlag) return false;
      const iso = r.publishedAt && /^\d{4}-\d{2}-\d{2}/.test(r.publishedAt) ? r.publishedAt : null;
      return iso ? iso >= cutoff : (r.fetchedAt ?? "") >= cutoff;
    })
    .map((r) => ({
      id: r.id,
      ticker: r.ticker,
      companyName: nameByTicker.get(r.ticker) ?? null,
      title: r.title,
      url: r.url,
      publishedAt: r.publishedAt,
      impact: r.impact,
      sentiment: r.sentiment,
      thesisFlag: !!r.thesisFlag,
      thesisNote: r.thesisNote,
      aiSummary: r.aiSummary,
    }));
}

/** Acknowledge (dismiss) a single announcement alert by news item id. */
export function dismissNewsItem(id: number): number {
  const db = getDb();
  return db.update(newsItems).set({ seen: true }).where(eq(newsItems.id, id)).run().changes ?? 0;
}
