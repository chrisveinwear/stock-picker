# Value Investor Investment Screening Tool — Research & Build Guide

*Exported from Claude Cowork session — 3 May 2026*

---

## Goal

Build a value investor investment screening, research, and company analysis tool to:
- Monitor an existing portfolio
- Identify potential investments (buy now vs. watch for later)
- Apply a methodology similar to Warren Buffett / Morningstar Research

---

## Existing Tools to Build On

### 1. `agi-now/buffett-skills` — Claude Code Skill
**Repo:** https://github.com/agi-now/buffett-skills

The most directly relevant project. A Claude Code skill that activates Buffett's complete investment thinking system. Compiled from 49 concept pages of Buffett's actual shareholder letters.

**Install into a Claude Code project:**
```bash
git clone https://github.com/agi-now/buffett-skills /tmp/buffett-skills
cp -r /tmp/buffett-skills/skills/buffett .claude/skills/buffett
```
Claude Code auto-discovers it — no registration needed.

**8 Reference Files included:**
| File | Content |
|------|---------|
| `01-thinking-frameworks.md` | Circle of competence, inversion, Mr. Market, Munger's models |
| `02-investment-philosophy.md` | Intrinsic value, compounding, undervaluation, concentration |
| `03-business-moat.md` | Five moat types, franchise vs. commodity, economic goodwill |
| `04-management-governance.md` | Three-dimensional management assessment, institutional imperative |
| `05-financial-metrics.md` | Owner earnings, ROIC/ROE, cash conversion rate |
| `06-valuation-capital.md` | Three valuation methods, margin of safety, capital allocation |
| `07-risk-behavior.md` | When to sell, value traps, leverage, behavioral biases |
| `08-industry-playbooks.md` | Insurance, banking, consumer, media, energy, railroads, tech |

**Output format every analysis produces:**
- Conclusion (Buy / Don't buy / Watch / Hold / Sell + one-sentence rationale)
- Circle of Competence
- Key Assumptions (3–5)
- Business Quality (Moat type + strength + trend, management)
- Financial Snapshot (ROIC, cash conversion, owner earnings)
- Valuation (intrinsic value range, margin of safety %, entry price)
- Sell Criteria Check
- Key Risks (top 3)
- Monitoring Indicators
- Final Verdict in Buffett's voice

---

### 2. `danielchu97/Value-Investing-Agent` — MCP Server with Live Data
**Repo:** https://github.com/danielchu97/Value-Investing-Agent
**npm:** `value-investing-agent`

Full MCP server built on Graham + Buffett principles. Connects to live market data.

**Install (one line):**
```bash
npx value-investing-agent
```

**Or add to Claude Code MCP config (`~/.claude.json`):**
```json
{
  "mcpServers": {
    "value-investing-agent": {
      "command": "npx",
      "args": ["-y", "value-investing-agent"],
      "env": {
        "FINNHUB_API_KEY": "your_free_key_from_finnhub.io"
      }
    }
  }
}
```

**Tools provided:**
| Tool | Description |
|------|-------------|
| `get_stock_quote` | Real-time quotes and metrics |
| `get_financials` | Income statement, balance sheet, cash flow |
| `calculate_intrinsic_value` | DCF model + Graham Number + margin of safety |
| `analyze_moat` | Competitive advantage evaluation |
| `get_news` | Stock-related news |
| `manage_watchlist` | Add/remove/group stocks |
| `generate_daily_report` | Daily watchlist digest |
| `generate_stock_report` | Full value investing analysis report |

**Data providers (free):**
- Yahoo Finance (default, no key needed, rate-limited)
- Finnhub (recommended — free key at finnhub.io, 60 calls/min)
- Alpha Vantage (free key at alphavantage.co, 5 calls/min)

**Key screening thresholds built in:**
- P/E < 15 (undervalued)
- P/B < 1.5 (undervalued)
- ROE > 15% (excellent)
- Gross Margin > 40% (pricing power)
- Net Margin > 10% (efficient)
- Current Ratio > 1.5 (liquid)
- Debt/Equity < 1.0 (conservative)
- Interest Coverage > 5× (safe)
- Margin of Safety: 25%+ discount to intrinsic value

---

### 3. `tradermonty/claude-trading-skills`
**Repo:** https://github.com/tradermonty/claude-trading-skills

Claude Code skills for equity investors and traders — screeners, market analysis, technical charting, fundamental analysis, economic calendars. Good complement to the Buffett skill for the discovery/screening phase.

---

### 4. `quant-sentiment-ai/claude-equity-research`
**Repo:** https://github.com/quant-sentiment-ai/claude-equity-research

Claude Code Plugin for institutional-grade equity research. Installable via Claude marketplace. Generates professional buy/sell recommendations with fundamental analysis, technical indicators, and risk assessment. Easiest to get running immediately.

---

### 5. Other Notable Tools
- **FinanceToolkit** (https://github.com/JerBouma/FinanceToolkit) — Transparent Python financial analysis library, 150+ metrics
- **ai-investor** (https://github.com/Bilovodskyi/ai-investor) — Buffett-mode AI signals + owner earnings DCF
- **FinAgents** (https://github.com/weirdapps/finagents) — Virtual investment committee with Buffett/Munger/Cathie Wood personas debating stocks
- **KeepRule Buffett Prompt** (https://keeprule.com/en/prompts/warren-buffett) — Standalone 8-dimension analysis prompt

---

## Ready-to-Use Prompts for Claude Code

Paste these directly into Claude Code. With `buffett-skills` installed they produce structured templated output; without it they still work well.

---

### Prompt 1 — Full Buffett-Style Deep Analysis

```
Analyze [TICKER] as Warren Buffett would. Cover:
1. Circle of competence check — is this business understandable?
2. Economic moat — which of the 5 moat types applies (cost advantage, switching costs, 
   network effects, intangible assets, efficient scale)? How durable?
3. Management quality — track record, capital allocation history, owner-orientation
4. Financial snapshot — ROIC, ROE, owner earnings (net income + D&A - capex), 
   cash conversion rate, debt/equity
5. Intrinsic value — run DCF with 3 scenarios (pessimistic/base/optimistic), compute 
   Graham Number as cross-check, calculate margin of safety at current price
6. Sell criteria — check all four (deteriorating moat, management integrity issues, 
   better opportunity elsewhere, price far exceeds value)
7. Verdict — Buy / Watch / Hold / Avoid with one-sentence rationale in Buffett's voice
```

---

### Prompt 2 — Quick Screening Checklist (Buffett's 8 Questions)

```
Run the Buffett quick screen on [TICKER]:
1. Do I understand the business in 2 minutes? (Circle of competence)
2. Has it earned consistently high returns on equity for 10 years? (ROE > 15% avg)
3. Does it have low or manageable debt? (D/E < 1.0)
4. Does it generate more cash than it consumes? (FCF positive)
5. Does management have a history of rational capital allocation?
6. Is the business protected by a durable moat?
7. Is the current price below my estimate of intrinsic value?
8. Is the margin of safety at least 25%?
Score: X/8. Recommend: INVESTIGATE FURTHER / PASS
```

---

### Prompt 3 — Morningstar-Style Moat Rating

```
Assign a Morningstar-style economic moat rating to [TICKER]:
- Wide Moat / Narrow Moat / No Moat
- Primary moat source (intangible assets / cost advantage / switching costs / 
  network effect / efficient scale)
- Moat trend (strengthening / stable / eroding)
- Estimated moat duration (years competitive advantage likely persists)
- Key threats to moat
- Moat confidence: High / Medium / Low with rationale
```

---

### Prompt 4 — Portfolio Monitoring Digest

```
For each stock in this watchlist: [TICKER1, TICKER2, TICKER3...]
Generate a portfolio monitoring digest:
- Current price vs. last-known intrinsic value estimate → margin of safety %
- Any changes to moat since last review?
- Any management/governance red flags in recent news?
- Upcoming catalysts (earnings, strategic announcements)
- Action recommendation: Hold / Add / Trim / Sell / Watch
Format as a clean table sortable by margin of safety.
```

---

### Prompt 5 — DCF Intrinsic Value Calculator

```
Calculate the intrinsic value of [TICKER] using a DCF model:

Inputs to find:
- Last 3 years of free cash flow (operating cash flow - capex)
- Average FCF growth rate over last 5 years
- Current net debt / cash position
- Shares outstanding

Scenarios:
- Bear case: FCF grows at [X-3]% for 10 years, then 2.5% terminal
- Base case: FCF grows at [X]% for 10 years, then 3% terminal  
- Bull case: FCF grows at [X+3]% for 10 years, then 3.5% terminal
- Discount rate: 10% (Buffett's minimum acceptable return)

Output:
- Intrinsic value per share (all 3 scenarios)
- Current price
- Margin of safety at current price
- Suggested entry price for 25% margin of safety
```

---

### Prompt 6 — Management Quality Assessment

```
Assess the management quality of [TICKER / CEO NAME] using Buffett's three dimensions:

1. ABILITY — Has management grown owner earnings? Navigated adversity well? 
   Made good acquisitions (paid fair prices, not empire building)?

2. OWNER-ORIENTATION — Do they communicate candidly (including failures)? 
   Do they own significant stock? Do buybacks happen below intrinsic value?

3. INTEGRITY — Any history of misleading shareholders? Related-party transactions? 
   Does compensation align with long-term performance?

Red flags to check: excessive stock options, frequent restatements, 
acquisition addiction, salary relative to peers, promised vs. delivered.

Rate: Exceptional / Good / Adequate / Concerning
```

---

## Recommended Build Path

**Phase 1 — This week (get something working immediately):**
1. Install `value-investing-agent` as MCP server (live data tools)
2. Clone `buffett-skills` into your Claude Code project (reasoning framework)
3. Use the prompts above directly in Claude Code

**Phase 2 — Next week (make it yours):**
1. Create a `CLAUDE.md` file in your project defining:
   - Your portfolio holdings
   - Your watchlist (companies to follow)
   - Your target sectors
   - Your personal return hurdle (Buffett uses 10%)
   - Your margin of safety threshold (typically 25–35%)
2. This makes every analysis personalised rather than generic

**Phase 3 — Ongoing (automate):**
1. Use Claude Code's `/schedule` command to run a weekly portfolio digest automatically
2. Set it to send results to Slack or email every Monday morning
3. Structure: portfolio holdings (hold/trim/sell) + watchlist (margin of safety update) + new opportunities above the threshold

---

## Key Concepts Reference

### Warren Buffett's Mental Models
- **Circle of Competence** — Only invest in businesses you genuinely understand
- **Mr. Market** — Market price is an offer, not a verdict; use volatility as opportunity
- **Margin of Safety** — Buy at a significant discount to intrinsic value (25%+ minimum)
- **Owner Earnings** — Net income + Depreciation/Amortisation − Maintenance Capex
- **Economic Goodwill** — A business worth more than its book value because of intangible advantages

### Five Types of Economic Moat (Morningstar Framework)
1. **Intangible Assets** — Brands, patents, regulatory licences (e.g. Coca-Cola, Pfizer)
2. **Cost Advantage** — Structural cost lower than competitors (e.g. Walmart, GEICO)
3. **Switching Costs** — Painful/expensive for customers to leave (e.g. Salesforce, Oracle)
4. **Network Effects** — Product gets more valuable as more people use it (e.g. Visa, Meta)
5. **Efficient Scale** — Niche market served by limited competitors at natural capacity (e.g. railways, pipelines)

### Valuation Methods
1. **DCF (Discounted Cash Flow)** — Primary method; discount future owner earnings at 10%
2. **Graham Number** — √(22.5 × EPS × Book Value per Share) — ceiling price for defensive investors
3. **Earnings Power Value** — What the business is worth with zero growth assumed

---

*Note: All tools and prompts are for research and educational purposes only. Not financial advice.*

---

## Phase 1 — Completion Status ✓

*Completed: 3 May 2026*

### What Was Built

**`buffett-skills` — 9 files written to `.claude/skills/buffett/`:**
| File | Status |
|------|--------|
| `SKILL.md` | ✓ Entry point — triggers the skill, defines output format |
| `01-thinking-frameworks.md` | ✓ Circle of competence, Mr. Market, Munger models |
| `02-investment-philosophy.md` | ✓ Intrinsic value, compounding, when to pay up for quality |
| `03-business-moat.md` | ✓ Five moat types, franchise vs. commodity, moat rating |
| `04-management-governance.md` | ✓ Three dimensions, institutional imperative, checklist |
| `05-financial-metrics.md` | ✓ Owner earnings, ROIC, ROE, cash conversion, red flags |
| `06-valuation-capital.md` | ✓ DCF, Graham Number, EPV, margin of safety, buybacks |
| `07-risk-behavior.md` | ✓ Four sell criteria, value traps, leverage, biases |
| `08-industry-playbooks.md` | ✓ Insurance, banking, consumer, media, energy, rail, tech, healthcare |

**`.mcp.json` — MCP server config written to project root:**
- Configures `value-investing-agent` via `npx` (auto-installs on first use)
- Placeholder `FINNHUB_API_KEY` ready to fill in

---

### One-Time Setup Steps (Do These Once in Your Terminal)

**Step 1 — Get your free Finnhub API key**
1. Go to [https://finnhub.io](https://finnhub.io) → Sign Up (free)
2. Copy your API key from the dashboard

**Step 2 — Add your API key to `.mcp.json`**

Open `stock-picker/.mcp.json` and replace `YOUR_FINNHUB_KEY_HERE` with your actual key.

**Step 3 — Open Claude Code in the stock-picker folder**
```bash
cd ~/Documents/Claude-Personal/stock-picker
claude
```

Claude Code will auto-discover the `buffett` skill and the `value-investing-agent` MCP server on first launch. You'll see a prompt to approve the MCP server — say yes.

**Step 4 — Test it**
```
Analyse AAPL as Warren Buffett would.
```
You should see the structured 8-section output format.

---

### Ready for Phase 2
Next: Create a `CLAUDE.md` in the stock-picker folder defining your portfolio, watchlist, return hurdle, and margin of safety threshold.
