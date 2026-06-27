# Automated staggered research refresh

Keeps every watch-list name, portfolio holding and physical metal on a rolling
monthly research cycle — one (or a few) reports regenerated per day, fully
automatically, with no running dev server required.

## How it works

- **Rotation** (`src/lib/refresh-queue.ts`) — builds a de-duplicated target list
  from `watchlist` + `portfolio_holdings` + `metal_holdings`, ranks them by how
  stale their latest `research_reports` row is (never-researched first), and
  selects the most-stale `ceil(N / 28)` whose last report is older than 25 days.
  This guarantees the whole list cycles within ~a month while never needlessly
  regenerating a fresh report.
- **Generation** (`scripts/refresh-due.ts`) — drives the same
  `/api/research/generate` handler the web app uses, in-process. Each report is
  written to `reports/[TICKER]/[DATE].md` and a dated `research_reports` row, so
  history accumulates over time.
- **Memory** (`src/lib/report-history.ts`) — before generating, prior reports for
  the ticker are injected into the prompt as a "Historical Context" block, so each
  new report is aware of how its verdict / fair value / margin of safety have
  drifted. After generating, a **material change** (verdict flip, or fair value
  move ≥ 10%) is logged to `alert_log` and surfaces in the app's alerts feed.

## Run it manually

```bash
cd web
npm run refresh:due              # refresh today's due targets
npx tsx scripts/refresh-due.ts --dry-run     # show what would refresh, do nothing
npx tsx scripts/refresh-due.ts --per-day=3   # override daily quota
npx tsx scripts/refresh-due.ts --min-age=30  # override staleness threshold (days)

# Force a one-off regeneration of a specific item (bypasses the rotation)
npx tsx scripts/refresh-due.ts --ticker=CSL --type=stock --name="CSL Limited"
npx tsx scripts/refresh-due.ts --ticker=GOLD --type=metal --name="Gold (XAU/USD)"
```

What's due is also visible via the API: `GET /api/research/refresh-due?all=1`.

## Schedule it daily (launchd)

```bash
# 1. Copy the job into place
cp web/scripts/com.stockpicker.refresh.plist ~/Library/LaunchAgents/

# 2. Load it (runs daily at 07:30)
launchctl load ~/Library/LaunchAgents/com.stockpicker.refresh.plist

# Check / trigger / remove
launchctl list | grep stockpicker
launchctl start com.stockpicker.refresh        # run once now
launchctl unload ~/Library/LaunchAgents/com.stockpicker.refresh.plist
```

Output is appended to `web/scripts/refresh-due.log`.

### Requirements & caveats

- The **Claude CLI must be authenticated** (`claude login`) — generation spawns it.
- The Mac must be **awake at 07:30** (or it runs once shortly after waking).
- If the CLI usage limit is hit mid-run, the script stops early; remaining targets
  roll to the next day's run automatically.
- To change the time, edit `StartCalendarInterval` in the plist and reload it.
