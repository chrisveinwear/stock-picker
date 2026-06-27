/**
 * Live news and ASX announcement fetching for research report enrichment.
 *
 * Primary: Firecrawl search API (real-time, full content)
 * Fallback: yahoo-finance2 quoteSummary news (delayed, summaries only)
 *
 * Firecrawl errors (rate limit 429, auth 401, network) are caught and logged;
 * the function always returns something usable.
 */

import yahooFinance from "yahoo-finance2";

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? "fc-3edd230e1a504943be071a48b59e35c1";
const FIRECRAWL_BASE = "https://api.firecrawl.dev/v2";

export type NewsItem = {
  title: string;
  url?: string;
  publishedAt?: string;
  summary?: string;
  source: "firecrawl" | "yahoo";
};

export type NewsFetchResult = {
  items: NewsItem[];
  source: "firecrawl" | "yahoo" | "none";
  warning?: string;
};

/** Firecrawl result item — fields vary by source (news vs web) and API version. */
type FirecrawlItem = {
  title?: string;
  url?: string;
  // news source uses `date` (e.g. "Nov 12, 2025"); web/v1 used `publishedDate`
  date?: string;
  publishedDate?: string;
  // news source uses `snippet`; web source uses `description`; scrape adds `markdown`
  snippet?: string;
  description?: string;
  markdown?: string;
};

/** Normalise Firecrawl's human date ("Nov 12, 2025") to an ISO string when parseable. */
function normaliseDate(raw?: string): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

async function fetchViaFirecrawl(query: string, limit = 8): Promise<NewsItem[]> {
  const res = await fetch(`${FIRECRAWL_BASE}/search`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${FIRECRAWL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      limit,
      // Query the news source for dated, relevant headlines (not generic landing
      // pages). No scrapeOptions: scraping every result is slow, credit-heavy, and
      // pulls in navigation chrome instead of article content.
      sources: ["news"],
      tbs: "qdr:y", // last 12 months
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = await res.json() as {
    success: boolean;
    // v2 returns data.news / data.web; v1 returned data as a flat array
    data?: { news?: FirecrawlItem[]; web?: FirecrawlItem[] } | FirecrawlItem[];
  };

  if (!json.success || !json.data) return [];

  const items: FirecrawlItem[] = Array.isArray(json.data)
    ? json.data
    : json.data.news ?? json.data.web ?? [];

  if (items.length === 0) return [];

  return items.map((item) => ({
    title: item.title ?? "Untitled",
    url: item.url,
    publishedAt: normaliseDate(item.date ?? item.publishedDate),
    summary: (item.snippet ?? item.description ?? item.markdown ?? "")
      .slice(0, 600)
      .trim() || undefined,
    source: "firecrawl" as const,
  }));
}

async function fetchViaYahoo(ticker: string): Promise<NewsItem[]> {
  try {
    const result = await (yahooFinance as any).quoteSummary(ticker, {
      modules: ["assetProfile"],
    });
    // Yahoo quoteSummary doesn't expose news easily; use search instead
    const search = await (yahooFinance as any).search(ticker, { newsCount: 8 });
    const news = (search?.news ?? []) as Array<{
      title: string;
      link?: string;
      providerPublishTime?: number;
      publisher?: string;
    }>;
    return news.map((n) => ({
      title: n.title,
      url: n.link,
      publishedAt: n.providerPublishTime
        ? new Date(n.providerPublishTime * 1000).toISOString()
        : undefined,
      summary: `via ${n.publisher ?? "Yahoo Finance"}`,
      source: "yahoo" as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Fetch recent news and ASX announcements for a ticker.
 * Tries Firecrawl first; falls back to Yahoo Finance on any error.
 */
export async function fetchRecentNews(
  ticker: string,
  companyName?: string
): Promise<NewsFetchResult> {
  const baseTicker = ticker.replace(".AX", "").replace(/\s+/g, "_");
  const nameHint = companyName ? ` ${companyName}` : "";
  const query = `ASX:${baseTicker}${nameHint} ASX announcement results news`;

  try {
    const items = await fetchViaFirecrawl(query);
    if (items.length > 0) {
      return { items, source: "firecrawl" };
    }
    // Firecrawl returned empty results — fall through to Yahoo
    throw new Error("No results from Firecrawl");
  } catch (err) {
    const warning = `Firecrawl unavailable (${(err as Error).message.slice(0, 120)}), using Yahoo Finance fallback.`;
    console.warn("[news-fetcher]", warning);

    const yahooItems = await fetchViaYahoo(ticker);
    if (yahooItems.length > 0) {
      return { items: yahooItems, source: "yahoo", warning };
    }

    return { items: [], source: "none", warning };
  }
}

export function formatNewsForPrompt(result: NewsFetchResult): string {
  if (result.items.length === 0) {
    return result.warning
      ? `[News fetch failed: ${result.warning}]`
      : "[No recent news found]";
  }

  const sourceLabel = result.source === "firecrawl"
    ? "Firecrawl live search"
    : "Yahoo Finance (delayed)";

  const lines = result.items.map((item, i) => {
    // ISO dates → show YYYY-MM-DD; relative dates ("1 month ago") → show as-is
    const rawDate = item.publishedAt;
    const displayDate = rawDate
      ? (/^\d{4}-\d{2}-\d{2}/.test(rawDate) ? rawDate.slice(0, 10) : rawDate)
      : "";
    const date = displayDate ? ` (${displayDate})` : "";
    const url = item.url ? `\n   URL: ${item.url}` : "";
    const summary = item.summary ? `\n   ${item.summary}` : "";
    return `${i + 1}. ${item.title}${date}${url}${summary}`;
  });

  const warning = result.warning ? `\n⚠️  ${result.warning}` : "";

  return `### Recent News & ASX Announcements (source: ${sourceLabel})${warning}\n\n${lines.join("\n\n")}`;
}
