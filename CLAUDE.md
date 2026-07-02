# Stock Picker — Personal Investment Analysis Tool

This project is a value investor screening, research, and portfolio tracking tool for **ASX (Australian Securities Exchange)** companies, applying Warren Buffett / Morningstar methodology.

## Web App (Phase 1–3 complete)

The Next.js app lives in `web/`. To run:
```bash
cd web && npm run dev   # http://localhost:3000
```

**Stack:** Next.js 15 App Router · Drizzle ORM · SQLite (`web/data/stock-picker.db`) · Shadcn/ui · Tailwind v4 · yahoo-finance2

**Pages:** Dashboard `/` · Research Reports `/research` · Stock Picks `/picks` · Watchlist `/watchlist` · Portfolio `/portfolio`

**Architecture:** Client fetches → Next.js API routes → yahoo-finance2 (15-min cache in SQLite) · Research reports stored as markdown in `web/reports/[TICKER]/[YYYY-MM-DD].md`

**Data sources:**
- ASX prices: Yahoo Finance via `yahoo-finance2` (`.AX` suffix, no key needed)
- US prices: Finnhub (key in `.mcp.json`)
- Portfolio holdings: manual entry or Sharesight (pending API credentials)

**Known gotcha:** Yahoo Finance historical data for some `.AX` stocks has inaccurate pre-adjustment prices. Use current price quotes for cost-base calculations; treat historical charts as indicative.

---

## Investment Philosophy

- **Style**: Long-term value investing (Buffett/Graham/Munger)
- **Return hurdle**: 10% minimum annualised return
- **Margin of safety**: 30% minimum discount to intrinsic value (35%+ preferred)
- **Holding horizon**: 5–10+ years; buy to hold, not to trade
- **Circle of competence**: ASX-listed businesses in sectors I understand (see below)

---

## Portfolio Holdings

| Ticker | Company | Sector | Avg Buy Price | Notes |
|--------|---------|--------|--------------|-------|
| _(add holdings here)_ | | | | |

**Instructions**: When monitoring the portfolio, check each holding quarterly:
- Has the moat changed?
- Any management/governance red flags?
- Current price vs. intrinsic value estimate → margin of safety %
- Action: Hold / Add / Trim / Sell

---

## Watchlist

Stocks I'm monitoring but haven't bought yet. Alert me when margin of safety reaches 30%+.

| Ticker | Company | Sector | Target Entry Price | Why Watching |
|--------|---------|--------|--------------------|--------------|
| _(add watchlist stocks here)_ | | | | |

---

## Sectors Within Circle of Competence

Focus analysis on these sectors where business models are understandable:

- **Consumer staples** — food, beverages, household products (e.g. WOW, COL, MTS)
- **Financial services** — major banks, insurance (e.g. CBA, WBC, QBE, SUN)
- **Healthcare** — hospitals, pathology, pharmaceuticals (e.g. RHC, SHL, CSL)
- **Infrastructure** — toll roads, airports, utilities (e.g. TCL, APA, AST)
- **Technology** — ASX-listed software/SaaS with recurring revenue (e.g. WTC, XRO, TLX)
- **Resources** — selective; only wide-moat or lowest-cost producers (e.g. BHP, RIO, FMG)

**Avoid** (outside circle of competence): Early-stage biotech, speculative miners, complex financials.

---

## Screening Thresholds (Minimum Bar to Investigate)

| Metric | Threshold |
|--------|-----------|
| P/E ratio | < 20× (ideally < 15×) |
| P/B ratio | < 2.5× |
| ROE (10yr avg) | > 15% |
| Net margin | > 10% |
| Debt/Equity | < 1.0× |
| Interest coverage | > 5× |
| FCF positive | Yes (last 3 years) |
| Margin of safety | ≥ 30% discount to intrinsic value |

---

## Analysis Format

When asked to analyse any stock, produce a **Comprehensive Investment Research Report** combining the Buffett framework with 10 institutional analysis lenses. Reports are saved as markdown to `web/reports/[TICKER]/[YYYY-MM-DD].md` with frontmatter.

### Report Frontmatter
```
---
ticker: CBA.AX
companyName: Commonwealth Bank of Australia
reportDate: YYYY-MM-DD
verdict: watch          # buy | watch | hold | avoid
intrinsicValueLow: 140
intrinsicValueHigh: 160
marginOfSafety: 12.5    # % discount to midpoint IV at time of report
---
```

### Report Structure (all sections required)

---

**VERDICT** — `[Buy / Watch / Hold / Avoid]` — one sentence in Buffett's voice, then current price, IV range, and MOS %.

---

**PART A — BUFFETT VALUE FRAMEWORK**

1. **Circle of Competence** — Can the business be explained simply? Inside / boundary / outside. If outside, stop here and explain why.
2. **Key Assumptions (3–5)** — Explicit assumptions the thesis depends on; list for later verification.
3. **Business Quality & Moat** — Moat type (intangible / cost / switching / network / scale), strength (wide / narrow / none), trend (widening / stable / narrowing). Five-year moat durability test.
4. **Management Assessment** — Integrity (auto-veto if fails), capital allocation track record, owner mentality, institutional imperative warnings.
5. **Financial Snapshot** — ROIC (10yr avg), owner earnings, cash conversion rate, debt safety (revenue −30% stress test). Key ratios: P/E, P/B, ROE, net margin, D/E, interest coverage, FCF.
6. **Valuation & Margin of Safety** — Three methods: DCF (owner earnings), Graham Number, earnings yield vs bond. Intrinsic value range. Current MOS %. Recommended entry price.
7. **Sell Criteria Check** — All four criteria explicitly judged: (1) severely overvalued? (2) moat destroyed? (3) management integrity issue? (4) better opportunity exists?
8. **Monitoring Indicators** — What to check each quarter; specific triggers that would change the verdict.

---

**PART B — INSTITUTIONAL ANALYSIS LENSES**

9. **Goldman Sachs Screener** — Screening scorecard: P/E vs sector avg, 5yr revenue CAGR, D/E health, dividend yield + payout sustainability, moat rating (weak/moderate/strong), risk rating 1–10, 12-month bull/bear price targets, entry zone.

10. **Morgan Stanley DCF** — 5-year revenue projections with stated growth assumptions, operating margin estimates, free cash flow year-by-year, WACC estimate, terminal value (exit multiple + perpetuity growth), sensitivity table (fair value at ±1% discount rate), verdict: undervalued / fairly valued / overvalued.

11. **Bain Competitive Landscape** — Top 4–6 ASX/global peers with market cap and margin comparison table, competitive moat analysis per competitor, market share trend (3yr), SWOT for the top 2 competitors, single best pick rationale, 12-month catalysts.

12. **JPMorgan Earnings Analysis** — ASX companies report **half-yearly** (H1/FY), not quarterly. Analyse the most recent half-year and full-year results from the provided financial history and news: revenue/earnings trajectory, key metrics the market is watching, segment trends, management guidance. Consensus-estimate history and post-earnings price reactions are only included **when the data is supplied** — never fabricate an EPS-vs-consensus table; if consensus data is unavailable, say so. Bull/bear scenario price impact.

13. **Bridgewater Risk Assessment** — Interest rate sensitivity, inflation sensitivity, recession stress test (estimated drawdown %), liquidity risk, leverage risk, tail risk scenarios (low/medium probability). Hedging considerations.

14. **Harvard Endowment — Dividend Analysis** *(skip if no dividend)* — Current yield, dividend safety score (1–10), consecutive years of growth, payout ratio, 5yr dividend CAGR, DRIP compounding projection (10yr at current yield), sustainability verdict.

15. **Citadel Technical Analysis** — All indicator readings (moving averages, RSI, MACD, support/resistance, volume trend) MUST come from the system-computed technicals block provided with the prompt — never estimated or recalled. Interpret those exact readings in plain English: trend direction, MA position and crossovers, momentum, key levels. Ideal entry price, stop-loss, and 12-month technical target. Risk-to-reward ratio. Confidence: Strong Buy / Buy / Neutral / Sell / Strong Sell. If no computed technicals were provided, state that and keep this section qualitative.

16. **Renaissance Quant Patterns** — Only from supplied data: insider buying/selling, institutional-ownership trends, and short interest are usually NOT available — state "data not available" for each rather than inventing figures. What remains is qualitative: seasonal/behavioural tendencies (clearly framed as general patterns, not measurements), sensitivity to ASX macro events (RBA meetings, CPI), and price behaviour visible in the computed technicals.

17. **McKinsey Macro Context (Australia)** — RBA rate outlook and impact on this stock. Australian inflation and GDP trends. AUD strength impact. Sector rotation signals. Specific macro tailwinds/headwinds for this company. Timeline for macro factors to affect this stock.

---

### Report Depth Tiers

| Trigger | Depth |
|---------|-------|
| Quick screen ("is X worth looking at?") | Part A sections 1–3 only |
| Standard analysis | Full Part A + Part B summaries |
| Deep dive / buy decision | Full Part A + full Part B with all tables |

---

## Tools Available

### Core Skills
- **Buffett skill** (`.claude/skills/buffett/`): Deep value analysis — auto-triggers on any stock analysis request. Reads reference files, applies 8-question filter, produces 17-section comprehensive report.

### Financial Services Agents (from Anthropic financial-services repo)
All four agents are adapted for ASX context. Data sources: Yahoo Finance API, ASX MCP, web search (see `.claude/skills/asx-data-sources.md`).

- **Earnings Reviewer** (`.claude/agents/earnings-reviewer.md`): Post-earnings analysis when an ASX company reports H1 or FY results. Produces variance table, thesis update, estimate revisions, morning note. Triggers on "earnings update for [TICKER]", "[TICKER] H1/FY results".

- **Model Builder** (`.claude/agents/model-builder.md`): Builds DCF, three-statement, and comps models from scratch for any ASX stock. Every output traces to an assumption. Triggers on "build a DCF for [TICKER]", "model [TICKER]", "comps table for [SECTOR]".

- **Market Researcher** (`.claude/agents/market-researcher.md`): Sector and thematic primers — industry overview, competitive landscape, peer comps, ASX ideas shortlist. Triggers on "research the [sector] sector", "best ASX stocks in [sector]", "ASX sector primer".

- **Valuation Reviewer** (`.claude/agents/valuation-reviewer.md`): Portfolio-wide valuation review — current price vs. IV for every holding, MOS screen, returns analysis, IC memos. Triggers on "review my portfolio valuations", "returns analysis for [TICKER]", "which holdings should I review".

### Sub-skills (invoked by agents)
Each agent has dedicated sub-skills in `.claude/skills/[agent-name]/`:
- Earnings Reviewer: `earnings-analysis` · `morning-note` · `earnings-preview` · `model-update` · `audit-xls`
- Model Builder: `dcf-model` · `3-statement-model` · `comps-analysis` · `audit-xls`
- Market Researcher: `sector-overview` · `competitive-analysis` · `comps-analysis` · `idea-generation`
- Valuation Reviewer: `portfolio-monitoring` · `returns-analysis` · `ic-memo`

### Data MCP Tools
- **ASX MCP** (`mcp__asx-mcp__*`): `get_asx_ticker_info`, `get_asx_ticker_history`, `get_asx_ticker_news`, `search_asx_ticker`
- **value-investing-agent MCP**: `get_stock_quote`, `get_financials`, `calculate_intrinsic_value`, `analyze_moat`

---

## Setup Notes

- **ASX data provider**: Yahoo Finance (no key needed — use `.AX` suffix, e.g. `CBA.AX`, `BHP.AX`)
- **US data provider**: Finnhub (free key configured in `.mcp.json` — 60 calls/min)
- **Finnhub note**: Free tier is US-only; all ASX queries go through Yahoo Finance
- **ASX ticker format**: Always append `.AX` — e.g. `CBA.AX`, `WOW.AX`, `CSL.AX`

---

## Commodity Analysis

Physical commodities (gold, silver, lithium, copper, oil, iron ore, etc.) follow completely different analysis logic from equities — priced by supply/demand balance at the marginal tonne, not by earnings or moats.

**Full commodity playbook:** See `COMMODITIES.md` in the project root.

Key difference: the commodity equivalent of "intrinsic value" is the **incentive price** (cost to produce the marginal tonne at a 15% IRR). Buy when spot is below incentive price; avoid when spot is far above the 90th-percentile AISC.

**For metals holdings** in the portfolio (Perth Mint gold etc.): the `/metals` page tracks positions. Use `COMMODITIES.md` to frame any analysis or buy/sell decisions.

---

## Weekly Routine (Phase 3 — automate with `/schedule`)

1. Run portfolio digest: current prices vs. intrinsic value estimates
2. Flag any holdings approaching sell criteria
3. Check watchlist: any stocks hitting 30%+ margin of safety?
4. Review upcoming ASX earnings dates for portfolio + watchlist stocks
