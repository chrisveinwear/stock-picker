import { sqliteTable, text, real, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Research reports metadata — content lives as markdown files in /reports/[TICKER]/[DATE].md
export const researchReports = sqliteTable("research_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),             // e.g. "CBA.AX"
  companyName: text("company_name"),
  reportDate: text("report_date").notNull(),    // ISO date "2026-05-03"
  verdict: text("verdict"),                     // "buy" | "watch" | "avoid" | "hold"
  intrinsicValueLow: real("intrinsic_value_low"),
  intrinsicValueHigh: real("intrinsic_value_high"),
  marginOfSafety: real("margin_of_safety"),     // % at time of report
  buyBelow: real("buy_below"),                  // AI consensus buy price
  sellAbove: real("sell_above"),                // AI consensus sell price
  filePath: text("file_path"),                  // relative path to .md file
  generatedBy: text("generated_by").default("claude"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// Watchlist — stocks being monitored, not yet bought
export const watchlist = sqliteTable("watchlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull().unique(),
  companyName: text("company_name"),
  sector: text("sector"),
  intrinsicValue: real("intrinsic_value"),      // latest IV estimate from research
  targetBuyPrice: real("target_buy_price"),     // price at which to alert (IV × (1 - MOS threshold))
  marginOfSafetyThreshold: real("margin_of_safety_threshold").default(0.30),
  whyWatching: text("why_watching"),
  alertEnabled: integer("alert_enabled", { mode: "boolean" }).default(true),
  addedAt: text("added_at").default(sql`(datetime('now'))`),
});

// Stock picks — every investment thesis, tracked through its lifecycle
export const stockPicks = sqliteTable("stock_picks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name"),
  entryPrice: real("entry_price"),
  targetPrice: real("target_price"),            // IV estimate at time of pick
  thesis: text("thesis"),                       // 2-3 sentence summary
  moatType: text("moat_type"),
  status: text("status").default("watching"),  // "watching" | "bought" | "sold"
  boughtDate: text("bought_date"),
  soldDate: text("sold_date"),
  soldPrice: real("sold_price"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// Portfolio holdings — current positions
export const portfolioHoldings = sqliteTable("portfolio_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  companyName: text("company_name"),
  sector: text("sector"),
  shares: real("shares").notNull(),
  avgCost: real("avg_cost").notNull(),          // average cost per share AUD
  boughtDate: text("bought_date"),
  account: text("account").default("personal"),  // "personal" | "super" | "maxwell"
  source: text("source").default("manual"),    // "manual" | "sharesight" | "super"
  manualPrice: real("manual_price"),           // for managed funds/super not on Yahoo Finance
  priceType: text("price_type").default("live"), // "live" | "manual"
  notes: text("notes"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex("portfolio_holdings_ticker_account").on(t.ticker, t.account)]);

// Price cache — 15-minute TTL, reduces Yahoo Finance calls
export const priceCache = sqliteTable("price_cache", {
  ticker: text("ticker").primaryKey(),
  lastPrice: real("last_price"),
  previousClose: real("previous_close"),
  currency: text("currency").default("AUD"),
  marketCap: real("market_cap"),
  peRatio: real("pe_ratio"),
  fiftyTwoWeekHigh: real("fifty_two_week_high"),
  fiftyTwoWeekLow: real("fifty_two_week_low"),
  fetchedAt: text("fetched_at").default(sql`(datetime('now'))`),
});

// Metal transactions — physical gold, silver, platinum, palladium (weight-based,
// not share-based). Current holdings are always derived from this ledger (see
// lib/metals.ts getMetalPositions) rather than stored as a separate snapshot.
// Historical Perth Mint / GoldPass gold transactions were bulk-imported from
// account statements (scripts/import-gold-transactions.ts). ounces is signed
// (positive = acquired, negative = disposed) so SUM(ounces) per account+metal
// reconciles to the metal_holdings snapshot for that account+metal.
export const metalTransactions = sqliteTable("metal_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metal: text("metal").notNull(),              // "gold" | "silver" | "platinum" | "palladium"
  type: text("type").notNull(),                // "buy" | "sell" | "transfer_in" | "transfer_out"
  date: text("date").notNull(),                // ISO date "2023-08-13"
  ounces: real("ounces").notNull(),             // signed troy oz: + acquired, - disposed
  pricePerOzAud: real("price_per_oz_aud"),      // execution metal price per oz (AUD)
  feeAud: real("fee_aud"),
  totalAud: real("total_aud"),                  // signed net cash effect: - for a buy, + for a sell
  avgCostAudAfter: real("avg_cost_aud_after"),  // running weighted-avg cost/oz immediately after this row
  realizedGainAud: real("realized_gain_aud"),   // sells only: (price - prior avg cost) * ounces sold
  account: text("account").default("personal"), // "personal" | "maxwell"
  source: text("source"),                       // "Perth Mint GoldPass" | "Perth Mint Storage"
  orderId: text("order_id"),
  notes: text("notes"),
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// Fund/managed-investment transactions — unit-based holdings (e.g. super fund
// options) priced per unit rather than per share. Mirrors metal_transactions:
// current position for a (ticker, account) is derived by replaying this
// ledger in date order (see lib/funds.ts getFundPosition), then written onto
// the matching portfolio_holdings row so the rest of the app is unaffected.
// units is signed (positive = bought, negative = sold). The first row for a
// given (ticker, account) is typically a synthetic "opening_balance" entry
// carrying forward pre-ledger history, so SUM(units) reconciles to a known
// confirmed total rather than starting from zero.
export const fundTransactions = sqliteTable("fund_transactions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),             // fund APIR code, e.g. "FSF0581AU"
  type: text("type").notNull(),                 // "opening_balance" | "contribution" | "fee_rebate" | "rollover_withdrawal" | "tax"
  date: text("date").notNull(),                 // ISO date "2025-07-14"
  units: real("units").notNull(),               // signed: + bought, - sold
  unitPrice: real("unit_price"),                // unit price at transaction (null for opening_balance)
  grossAud: real("gross_aud"),                  // before-tax amount (unsigned), if applicable
  taxAud: real("tax_aud"),                      // tax withheld (unsigned), if applicable
  netAud: real("net_aud"),                      // after-tax dollar amount that bought/sold the units (unsigned)
  avgCostAudAfter: real("avg_cost_aud_after"),  // running weighted-avg cost/unit immediately after this row
  realizedGainAud: real("realized_gain_aud"),   // sells only: (unit price - prior avg cost) * units sold
  account: text("account").default("super"),    // "super" | "personal" | "maxwell"
  source: text("source"),                       // e.g. "Colonial First State - FirstChoice Wholesale Personal Super"
  notes: text("notes"),                         // e.g. "Super Guarantee from Fable Food Pty Ltd"
  createdAt: text("created_at").default(sql`(datetime('now'))`),
});

// Valuation assumption overrides — layered on top of the git-versioned file
// defaults by the valuation engine's resolver. scope = "global" | a sector name
// | a ticker; more specific scopes win. File defaults remain the audit baseline.
export const valuationAssumptions = sqliteTable("valuation_assumptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scope: text("scope").notNull(),          // "global" | sector | ticker (e.g. "CSL.AX")
  key: text("key").notNull(),              // e.g. "riskFreeRate", "terminalGrowth"
  value: real("value").notNull(),
  note: text("note"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex("valuation_assumptions_scope_key").on(t.scope, t.key)]);

// Alert log — history of triggered alerts
export const alertLog = sqliteTable("alert_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  alertType: text("alert_type"),               // "buy_zone" | "sell_zone" | "announcement"
  triggerPrice: real("trigger_price"),
  targetPrice: real("target_price"),
  marginOfSafety: real("margin_of_safety"),
  triggeredAt: text("triggered_at").default(sql`(datetime('now'))`),
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
});

// News items — deduped per-holding news store powering the dashboard "what moved
// my holdings" digest. Items accumulate across irregular visits (we never drop
// unseen news); each is classified by Haiku for sentiment/impact/thesis-relevance.
export const newsItems = sqliteTable("news_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  title: text("title").notNull(),
  url: text("url"),
  publishedAt: text("published_at"),            // ISO date (or raw relative string)
  summary: text("summary"),                     // source snippet
  sentiment: text("sentiment"),                 // "positive" | "neutral" | "negative"
  impact: text("impact"),                       // "high" | "medium" | "low"
  thesisFlag: integer("thesis_flag", { mode: "boolean" }).default(false),
  thesisNote: text("thesis_note"),              // which assumption it touches, if any
  aiSummary: text("ai_summary"),                // one-line Haiku take
  seen: integer("seen", { mode: "boolean" }).default(false),
  fetchedAt: text("fetched_at").default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex("news_items_ticker_url").on(t.ticker, t.url)]);

// Morningstar reference data — periodically imported from a Morningstar portfolio
// CSV export (the user has a personal subscription but no API entitlement, so the
// data is pulled by hand and uploaded). One row per (ticker, asOfDate) snapshot so
// history is preserved; reports use the latest snapshot. Parsing is intentionally
// tolerant (see lib/morningstar.ts) — the export's columns/format may change.
export const morningstarData = sqliteTable("morningstar_data", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),              // normalised, e.g. "CSL.AX"
  holdingName: text("holding_name"),             // raw name as exported
  economicMoat: text("economic_moat"),           // "None" | "Narrow" | "Wide"
  priceToFairValue: real("price_to_fair_value"), // Morningstar Price/Fair Value ratio
  starRating: integer("star_rating"),            // 1–5, if the export includes it
  uncertainty: text("uncertainty"),              // "Low" | "Medium" | … if present
  capitalAllocation: text("capital_allocation"), // "Poor"|"Standard"|"Exemplary" if present
  fairValueType: text("fair_value_type"),        // "quantitative" | "analyst" | null (user-noted)
  asOfDate: text("as_of_date").notNull(),        // ISO date the data reflects (from filename)
  importedAt: text("imported_at").default(sql`(datetime('now'))`),
}, (t) => [uniqueIndex("morningstar_data_ticker_asof").on(t.ticker, t.asOfDate)]);

// Per-ticker fetch pointer — drives "fetch everything since the last recorded
// fetch" so a user who opens the app irregularly never misses news.
export const newsFetchState = sqliteTable("news_fetch_state", {
  ticker: text("ticker").primaryKey(),
  lastFetchedAt: text("last_fetched_at"),       // ISO datetime of last successful fetch
  lastError: text("last_error"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});
