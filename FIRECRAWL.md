# Firecrawl Usage & Roadmap

How this project uses [Firecrawl](https://firecrawl.dev), how it's set up, and where we could take it next.

---

## Setup

- **Auth**: The Firecrawl CLI (`/opt/homebrew/bin/firecrawl`) is authenticated via browser login to `firecrawl.dev`. Config (incl. API key) lives at `~/Library/Application Support/firecrawl-cli`.
- **App key**: The Next.js app reads `FIRECRAWL_API_KEY` from `web/.env.local` (gitignored). **Never hardcode the key in source** — see the security note below.
- **Account / dashboard**: `firecrawl.dev` (the browser login used during CLI setup *is* the dashboard — that's where API keys are managed/rotated and credit usage is viewed).
- **CLI key management**: `firecrawl view-config` (status), `firecrawl login -k <key>` (re-point to a new key), `firecrawl env -f web/.env.local` (pull key into an env file), `firecrawl credit-usage`. There is **no CLI command to rotate/mint** a key — that is a `firecrawl.dev` web action.

### 🔐 Security note (key rotation)

The key was once hardcoded in `web/src/lib/news-fetcher.ts` and committed to this **public** repo (commit `aeccda0`). If you see a `fc-…` literal in source again, treat it as leaked:
1. Rotate it at `firecrawl.dev` → API Keys → revoke the exposed key, create a new one.
2. Put the new key in `web/.env.local` and run `firecrawl login -k <newkey>` to re-point the CLI.
3. Confirm no `fc-…` literal remains in source: `git grep "fc-"`.

---

## Current usage

| Where | Endpoint | Notes |
|-------|----------|-------|
| `web/src/lib/news-fetcher.ts` | `/v2/search` (`sources: ["news"]`, `tbs: qdr:y`) | Fetches dated, relevant news for research-report generation; falls back to Yahoo Finance on error. |

That's the only integration point today — we use a small fraction of Firecrawl's surface.

### Optimality improvements (non-urgent)

- **Use the installed SDK**: `@mendable/firecrawl-js@^4.28.3` is in `package.json` but unused; `news-fetcher.ts` calls `/v2/search` via raw `fetch`. The SDK adds retries, typing, and error handling.
- **Cache news in SQLite**: News is re-fetched on every report generation. Cache it (mirror the `price_cache` pattern) to cut credits and let a news UI panel reuse the data.

---

## Relevant Firecrawl templates (github.com/firecrawl)

Sorted by fit, not stars:

- **fireplexity** (1.9k★) — Perplexity-style answer engine: live search + cited, streamed answers. Blueprint for "Ask about this stock/sector" and AI news summaries with sources.
- **firecrawl-observer** (534★) — website change monitoring with an AI judge that filters noise and fires email/webhook alerts. Blueprint for ASX-announcement / holding-news alerts.
- **firesearch** (486★) / **open-researcher** (667★) — deep multi-step research agents → richer sector primers than a single search.
- **gemini-trendfinder** — trend detection from web data → sector momentum / thematic idea generation.
- **firecrawl-workflows** — workflow orchestration (search→extract→summarize chains).
- **firecrawl-mcp-server** / **firecrawl-claude-plugin** — an MCP server would let the report-generation CLI agent pull live data mid-report.

---

## Roadmap — new feature ideas (prioritized)

1. **Portfolio / Dashboard news digest** ⭐ *best ROI* — "what moved my holdings." Per-holding `/search` news (last 24–48h) → Claude summarizes the 3–5 most impactful items with sentiment + link, flags anything touching a thesis assumption. Reuses the existing news-fetcher + daily-refresh cron.
2. **Per-sector news & thematic analysis** — aggregate news across a sector's holdings/peers → Claude "sector pulse" (tailwinds/headwinds, who's affected). Pairs with the market-researcher agent.
3. **Announcement alerts (observer pattern)** — watch each holding's ASX announcements page; AI-filter to material items (results, guidance, downgrades, M&A) → push into the existing Action Alerts. Higher value than generic news.
4. **"Ask about this stock" (fireplexity-style)** — a search box on a report page that answers free-form questions with live, cited web data.

**Recommended order:** #1 first (highest value, reuses today's work), then #3. Both fit the app's daily-refresh routine.
