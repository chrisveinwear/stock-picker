# ASX Data Sources Reference

> This file replaces all references to mcp__factset__*, mcp__capiq__*, mcp__daloopa__*, and mcp__portfolio__* in the financial skills. Use the sources below for any ASX or Australian-listed stock analysis.

---

## Live Price & Fundamental Data

**Yahoo Finance (via project API):**
- `GET /api/prices?tickers=CBA.AX,BHP.AX` — real-time quotes (last price, change%, P/E, market cap, 52-week range)
- `GET /api/prices/history?ticker=CBA.AX&period=1y` — OHLCV history
- Always append `.AX` suffix for ASX-listed stocks

**ASX MCP tools (mcp__asx-mcp__*):**
- `mcp__asx-mcp__get_asx_ticker_info` — company profile, sector, market cap, financials
- `mcp__asx-mcp__get_asx_ticker_history` — historical price data
- `mcp__asx-mcp__get_asx_ticker_news` — recent ASX announcements and news
- `mcp__asx-mcp__search_asx_ticker` — find a ticker by company name

---

## Filings & Announcements (replaces SEC EDGAR / 10-Q / 8-K)

| US Equivalent | ASX Equivalent | Where to Find |
|--------------|----------------|---------------|
| 10-K (annual report) | Annual Report + Appendix 4E | ASX announcements: `https://www.asx.com.au/asx/statistics/announcements.do?by=asxCode&asxCode=[TICKER]` |
| 10-Q (quarterly) | Half-Year Report + Appendix 4D | Same ASX announcements page |
| 8-K (material event) | Appendix 3B / Market-Sensitive Announcement | Same page, filter by "Market Sensitive" |
| Earnings call transcript | Results presentation + Q&A webcast | Company investor relations website |
| Proxy statement | Notice of Annual General Meeting | ASX announcements |

**Key filing types to search for:**
- `"Appendix 4E"` — preliminary full-year results
- `"Appendix 4D"` — preliminary half-year results
- `"results presentation"` — management slides with guidance
- `"annual report"` — full statutory accounts

---

## Consensus Estimates

Use web search for ASX consensus data:
- Search: `"[TICKER] consensus estimates FY[YEAR] EPS revenue"`
- Sources: Visible Alpha, Refinitiv, Bloomberg (via published analyst notes), Simply Wall St, Stockopedia
- Australian broker reports: Macquarie, UBS, Morgans, Bell Potter, Ord Minnett, Shaw and Partners

---

## Currency & Reporting

- All ASX companies report in **AUD** (or NZD for NZ-primary companies dual-listed on ASX, e.g. A2M.AX)
- Financial year: **1 July – 30 June** (most ASX companies; exceptions: calendar year reporters like some miners)
- Key reporting dates: Full-year results typically **August**, Half-year typically **February**
- Dividends: Quoted in **AUD cents per share**; often **franked** (imputation credits)

---

## Portfolio Data (replaces mcp__portfolio__*)

- Portfolio holdings: `GET /api/portfolio` — returns all holdings with shares, avgCost, sector
- Picks tracker: `GET /api/picks` — stock picks with entry price, target price, thesis
- Watchlist: `GET /api/watchlist` — watchlist stocks with target buy price, intrinsic value
- Research reports: stored as markdown in `web/reports/[TICKER]/[YYYY-MM-DD].md`

---

## Macro & Market Context (Australian-specific)

- **RBA:** Reserve Bank of Australia (not Federal Reserve) — cash rate target, monetary policy statements at `rba.gov.au`
- **ABS:** Australian Bureau of Statistics — CPI, GDP, employment data
- **ASX 200:** Benchmark index (not S&P 500)
- **APRA:** Prudential regulator for banks/insurers (not Federal Reserve/OCC)
- **ASIC:** Securities regulator (equivalent to SEC)
- **Superannuation:** Australia's mandatory retirement savings system — major institutional buyer of ASX stocks
- **Franking credits:** Dividend imputation system unique to Australia — material for after-tax return calculations

---

## Output Format

- Research reports: Save as markdown to `web/reports/[TICKER]/[YYYY-MM-DD].md` with frontmatter (see CLAUDE.md for template)
- All prices in **AUD** unless ticker is NZD-reporting (e.g. A2M.AX)
- Use ASX ticker format: `CBA.AX`, `BHP.AX`, `WOW.AX`
