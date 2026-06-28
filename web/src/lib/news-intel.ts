/**
 * Portfolio news intelligence — the "what moved my holdings" digest.
 *
 * Per holding we fetch news since the last recorded fetch (gap-proof for users
 * who open the app irregularly), dedupe by URL, classify each item with Haiku
 * (sentiment / impact / thesis-relevance), and persist to news_items. The
 * dashboard reads the cached classification — no live fetch on page load.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { newsItems, newsFetchState, portfolioHoldings, researchReports, stockPicks } from "@/db/schema";
import { fetchRecentNews } from "@/lib/news-fetcher";
import { classifyNewsBatch, type NewsClassification } from "@/lib/ai/haiku";

// First run / long absence: never look back further than this.
const MAX_LOOKBACK_DAYS = 30;
// Dashboard shows news from roughly the last few weeks.
const DIGEST_WINDOW_DAYS = 21;

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
        ? `, intrinsic value ${report.intrinsicValueLow}–${report.intrinsicValueHigh}`
        : "";
    parts.push(`Latest verdict: ${report.verdict.toUpperCase()}${iv} (as of ${report.reportDate}).`);
  }
  if (pick?.thesis) parts.push(`Thesis: ${pick.thesis}`);
  if (pick?.moatType) parts.push(`Moat: ${pick.moatType}.`);
  return parts.join(" ");
}

export type RefreshResult = { ticker: string; added: number; error: string | null };

/** Fetch + classify + store new news for one ticker since its last fetch. */
export async function refreshTickerNews(
  ticker: string,
  companyName: string | null
): Promise<RefreshResult> {
  const db = getDb();
  const nowISO = new Date().toISOString();
  const state = db.select().from(newsFetchState).where(eq(newsFetchState.ticker, ticker)).get();

  const floor = isoDaysAgo(MAX_LOOKBACK_DAYS);
  const since = state?.lastFetchedAt && state.lastFetchedAt > floor ? state.lastFetchedAt : floor;

  let added = 0;
  let error: string | null = null;
  let advancePointer = true;

  try {
    const result = await fetchRecentNews(ticker, companyName ?? undefined);
    if (result.source === "none") {
      // Total fetch failure — keep the old pointer so we retry this window.
      advancePointer = false;
      error = result.warning ?? "no news source available";
    } else {
      if (result.warning) error = result.warning;
      const fresh = result.items.filter((it) => isAfter(it.publishedAt, since));

      const existing = new Set(
        db.select({ url: newsItems.url }).from(newsItems).where(eq(newsItems.ticker, ticker)).all().map((r) => r.url)
      );
      const novel = fresh.filter((it) => it.url && !existing.has(it.url));

      if (novel.length) {
        let cls: NewsClassification[];
        try {
          cls = await classifyNewsBatch(ticker, companyName, novel, getThesisContext(ticker));
        } catch (e) {
          // Classification unavailable (no key / API error) — store unclassified
          // rather than dropping the news; sentiment/impact stay null-ish.
          error = `classify failed: ${(e as Error).message?.slice(0, 120)}`;
          cls = novel.map(() => ({ sentiment: "neutral", impact: "low", thesisFlag: false, thesisNote: null, aiSummary: "" }));
        }
        db.insert(newsItems)
          .values(
            novel.map((it, i) => ({
              ticker,
              title: it.title,
              url: it.url ?? null,
              publishedAt: it.publishedAt ?? null,
              summary: it.summary ?? null,
              sentiment: cls[i].sentiment,
              impact: cls[i].impact,
              thesisFlag: cls[i].thesisFlag,
              thesisNote: cls[i].thesisNote,
              aiSummary: cls[i].aiSummary || null,
              fetchedAt: nowISO,
            }))
          )
          .onConflictDoNothing()
          .run();
        added = novel.length;
      }
    }
  } catch (e) {
    advancePointer = false;
    error = (e as Error).message?.slice(0, 200) ?? "unknown error";
  }

  db.insert(newsFetchState)
    .values({ ticker, lastFetchedAt: advancePointer ? nowISO : (state?.lastFetchedAt ?? null), lastError: error, updatedAt: nowISO })
    .onConflictDoUpdate({
      target: newsFetchState.ticker,
      set: { lastFetchedAt: advancePointer ? nowISO : (state?.lastFetchedAt ?? null), lastError: error, updatedAt: nowISO },
    })
    .run();

  return { ticker, added, error };
}

/** Refresh news for every held ASX equity. Sequential to stay gentle on rate limits. */
export async function buildNewsDigest(): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const { ticker, companyName } of heldEquityTickers()) {
    results.push(await refreshTickerNews(ticker, companyName));
  }
  return results;
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
      // Keep items published within the window; undated items kept if fetched recently.
      const stamp = r.publishedAt ?? r.fetchedAt;
      return !stamp || stamp >= cutoff || (r.publishedAt == null);
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
    const top = items.slice(0, maxPerTicker);
    const worstSentiment = items.some((i) => i.sentiment === "negative")
      ? "negative"
      : items.some((i) => i.sentiment === "positive")
        ? "positive"
        : "neutral";
    groups.push({
      ticker,
      companyName: nameByTicker.get(ticker) ?? null,
      items: top,
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
