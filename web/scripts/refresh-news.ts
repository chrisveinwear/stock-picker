/**
 * Headless portfolio news refresh.
 *
 * For every held ASX equity, fetches news since the last recorded fetch, classifies
 * each item with Haiku (sentiment / impact / thesis-relevance), and stores it in
 * news_items. Drives the dashboard "what moved my holdings" digest. Cheap and fast
 * (Firecrawl + one Haiku call per ticker with new news), so it runs daily.
 *
 * Run from the web/ directory:
 *   npx tsx scripts/refresh-news.ts
 *
 * The DB is gitignored — nothing to commit.
 */
import "@/lib/load-env"; // FIRST — loads FIRECRAWL_API_KEY etc.
import { buildNewsDigest } from "@/lib/news-intel";
import { classifierAvailable } from "@/lib/ai/classifier";

function log(...parts: unknown[]) {
  console.log(`[refresh-news ${new Date().toISOString()}]`, ...parts);
}

async function main() {
  if (!process.env.FIRECRAWL_API_KEY) log("warning: FIRECRAWL_API_KEY not set — news will fall back to Yahoo.");
  if (!classifierAvailable()) log("warning: Claude CLI not found — news stored unclassified.");

  const run = await buildNewsDigest();
  log(`refreshed ${run.refreshed} holdings · ${run.added} new item(s) · classified=${run.classified}`);
  for (const r of run.results.filter((r) => r.added > 0)) log(`  + ${r.ticker}: ${r.added}`);
  for (const e of run.results.filter((r) => r.error)) log(`  ! ${e.ticker}: ${e.error}`);
  log("done.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[refresh-news] fatal", e);
    process.exit(1);
  }
);
