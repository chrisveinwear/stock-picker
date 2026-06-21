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

// Metals holdings — physical gold, silver, platinum, palladium (weight-based, not share-based)
export const metalHoldings = sqliteTable("metal_holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  metal: text("metal").notNull(),           // "gold" | "silver" | "platinum" | "palladium"
  label: text("label"),                     // e.g. "Perth Mint — Unallocated Gold"
  ounces: real("ounces").notNull(),         // troy ounces held
  avgCostAud: real("avg_cost_aud"),         // average purchase price per oz in AUD
  location: text("location"),              // "Perth Mint" | "Home" | etc.
  storageType: text("storage_type"),       // "unallocated" | "allocated" | "certificate" | "coin"
  purchaseDate: text("purchase_date"),     // ISO date
  account: text("account").default("personal"), // "personal" | "maxwell"
  notes: text("notes"),
  updatedAt: text("updated_at").default(sql`(datetime('now'))`),
});

// Alert log — history of triggered alerts
export const alertLog = sqliteTable("alert_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticker: text("ticker").notNull(),
  alertType: text("alert_type"),               // "buy_zone" | "sell_zone"
  triggerPrice: real("trigger_price"),
  targetPrice: real("target_price"),
  marginOfSafety: real("margin_of_safety"),
  triggeredAt: text("triggered_at").default(sql`(datetime('now'))`),
  dismissed: integer("dismissed", { mode: "boolean" }).default(false),
});
