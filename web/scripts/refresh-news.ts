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
import "@/lib/load-env"; // FIRST — loads FIRECRAWL_API_KEY / ANTHROPIC_API_KEY
import { buildNewsDigest } from "@/lib/news-intel";
import { anthropicConfigured } from "@/lib/ai/haiku";

function log(...parts: unknown[]) {
  console.log(`[refresh-news ${new Date().toISOString()}]`, ...parts);
}

async function main() {
  if (!process.env.FIRECRAWL_API_KEY) log("warning: FIRECRAWL_API_KEY not set — news will fall back to Yahoo.");
  if (!anthropicConfigured()) log("warning: ANTHROPIC_API_KEY not set — news stored unclassified.");

  const results = await buildNewsDigest();
  const added = results.reduce((sum, r) => sum + r.added, 0);
  const errors = results.filter((r) => r.error);

  log(`refreshed ${results.length} holdings · ${added} new item(s) stored`);
  for (const r of results.filter((r) => r.added > 0)) log(`  + ${r.ticker}: ${r.added}`);
  for (const e of errors) log(`  ! ${e.ticker}: ${e.error}`);
  log("done.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[refresh-news] fatal", e);
    process.exit(1);
  }
);
