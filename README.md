# Stock Picker

ASX company investment analysis and tracking tool using Warren Buffett / Morningstar methodology, powered by Claude Code.

## What This Does

- Screen ASX stocks using Buffett's 8-question quick filter
- Deep-dive analysis: moat, management, financials, intrinsic value, margin of safety
- Monitor an existing portfolio for changes in quality or valuation
- Track a watchlist with entry price alerts at 30%+ margin of safety

## Setup

### 1. Get a free Finnhub API key
Go to [finnhub.io](https://finnhub.io) → Sign Up → copy your key.

### 2. Add your Finnhub key to `.mcp.json` (US stocks only)
```json
"FINNHUB_API_KEY": "your_key_here"
```
> **Note:** Finnhub free tier is US-only. All ASX data comes from Yahoo Finance (no key needed) using `.AX` tickers.

### 3. Open in Claude Code
```bash
cd stock-picker
claude
```

Claude Code auto-discovers the `buffett` skill and `value-investing-agent` MCP server on first launch.

### 4. Add your portfolio and watchlist
Edit `CLAUDE.md` to add your ASX holdings and watchlist stocks.

## Usage

**Quick screen a stock:**
```
Run the Buffett quick screen on ASX:CBA
```

**Full deep analysis:**
```
Analyse ASX:WOW as Warren Buffett would
```

**Portfolio digest:**
```
Generate a portfolio monitoring digest for my holdings
```

**Intrinsic value calculation:**
```
Calculate the intrinsic value of ASX:CSL using a DCF model
```

## Project Structure

```
stock-picker/
├── CLAUDE.md                          # Your portfolio, watchlist, personal config
├── .mcp.json                          # MCP server config (add your Finnhub key here)
├── value-investor-tool-research.md    # Research notes and build guide
└── .claude/
    └── skills/
        └── buffett/
            ├── SKILL.md               # Skill entry point
            └── references/
                ├── 01-thinking-frameworks.md
                ├── 02-investment-philosophy.md
                ├── 03-business-moat.md
                ├── 04-management-governance.md
                ├── 05-financial-metrics.md
                ├── 06-valuation-capital.md
                ├── 07-risk-behavior.md
                └── 08-industry-playbooks.md
```

## Phases

- **Phase 1** ✅ — buffett-skills + MCP server installed
- **Phase 2** ✅ — CLAUDE.md with personal config (portfolio, watchlist, ASX focus)
- **Phase 3** — Automate weekly digest with `/schedule`

## Credits

- [agi-now/buffett-skills](https://github.com/agi-now/buffett-skills) — Buffett reasoning framework
- [danielchu97/Value-Investing-Agent](https://github.com/danielchu97/Value-Investing-Agent) — Live market data MCP server
