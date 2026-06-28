import { getDb } from "@/db";
import { watchlist, portfolioHoldings, stockPicks, researchReports, metalHoldings } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { getQuotes, getMetalPrices } from "@/lib/yahoo-finance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import NewsDigestPanel from "@/components/NewsDigestPanel";
import Link from "next/link";

export const dynamic = "force-dynamic";

const verdictStyles: Record<string, string> = {
  buy: "bg-emerald-900 text-emerald-300",
  watch: "bg-amber-900 text-amber-300",
  avoid: "bg-red-900 text-red-300",
  hold: "bg-blue-900 text-blue-300",
};

function fmt(n: number) {
  return n.toLocaleString("en-AU", { maximumFractionDigits: 0 });
}

function pnlColour(pnl: number) {
  return pnl >= 0 ? "text-emerald-400" : "text-red-400";
}

export default async function DashboardPage() {
  const db = getDb();
  const allHoldings  = db.select().from(portfolioHoldings).all();
  const allMetals    = db.select().from(metalHoldings).all();
  const watchItems   = db.select().from(watchlist).where(eq(watchlist.alertEnabled, true)).all();
  const allWatchItems = db.select().from(watchlist).all();
  const recentReports = db.select().from(researchReports).orderBy(desc(researchReports.createdAt)).limit(5).all();
  const allPicks     = db.select().from(stockPicks).all();
  const activePicks  = allPicks.filter(p => p.status === "bought");

  // ── Live equity quotes ────────────────────────────────────────────────────
  const liveHoldings = allHoldings.filter(h => h.priceType !== "manual");
  const qMap: Record<string, number> = {};
  if (liveHoldings.length) {
    try {
      const quotes = await getQuotes(liveHoldings.map(h => h.ticker));
      for (const q of quotes) qMap[q.ticker] = q.lastPrice;
    } catch {}
  }

  function priceFor(h: typeof allHoldings[0]): number {
    if (h.priceType === "manual") return h.manualPrice ?? 0;
    return qMap[h.ticker] ?? 0;
  }

  // ── Metal spot prices ─────────────────────────────────────────────────────
  const spotMap: Record<string, number> = {};
  if (allMetals.length) {
    try {
      const mp = await getMetalPrices();
      spotMap.gold   = mp.goldAud;
      spotMap.silver = mp.silverAud;
    } catch {}
  }

  // ── Per-account totals ────────────────────────────────────────────────────
  function equityTotals(account: string) {
    const group = allHoldings.filter(h => (h.account ?? "personal") === account);
    const value = group.reduce((s, h) => s + priceFor(h) * h.shares, 0);
    const cost  = group.reduce((s, h) => s + (h.avgCost ?? 0) * h.shares, 0);
    return { value, cost, pnl: value - cost, count: group.length, holdings: group };
  }

  function metalTotals(account: string) {
    const group = allMetals.filter(m => (m.account ?? "personal") === account);
    const value = group.reduce((s, m) => s + m.ounces * (spotMap[m.metal] ?? 0), 0);
    const cost  = group.reduce((s, m) => s + m.ounces * (m.avgCostAud ?? 0), 0);
    const oz    = group.reduce((s, m) => s + m.ounces, 0);
    return { value, cost, pnl: value - cost, oz, holdings: group };
  }

  const personal = equityTotals("personal");
  const superAcc = equityTotals("super");
  const maxwell  = equityTotals("maxwell");
  const myMetals = metalTotals("personal");
  const mxMetals = metalTotals("maxwell");

  // My total = personal equities + super + my metals
  const myTotal  = personal.value + superAcc.value + myMetals.value;
  const myCost   = personal.cost  + superAcc.cost  + myMetals.cost;
  const myPnl    = myTotal - myCost;

  // Maxwell total = maxwell equities + maxwell metals
  const mxTotal  = maxwell.value + mxMetals.value;
  const mxCost   = maxwell.cost  + mxMetals.cost;
  const mxPnl    = mxTotal - mxCost;

  // Grand total
  const grandTotal = myTotal + mxTotal;
  const grandCost  = myCost  + mxCost;
  const grandPnl   = grandTotal - grandCost;
  const grandPnlPct = grandCost > 0 ? (grandPnl / grandCost) * 100 : 0;

  // Watchlist buy-zone count
  let buyZoneCount = 0;
  if (watchItems.length) {
    try {
      const wQuotes = await getQuotes(watchItems.map(w => w.ticker));
      const wMap = Object.fromEntries(wQuotes.map(q => [q.ticker, q]));
      buyZoneCount = watchItems.filter(w => {
        const q = wMap[w.ticker];
        return q && w.targetBuyPrice && q.lastPrice <= w.targetBuyPrice;
      }).length;
    } catch {}
  }

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-zinc-400 text-sm mt-1">All portfolios overview</p>
      </div>

      {buyZoneCount > 0 && (
        <Link href="/watchlist">
          <div className="rounded-lg border border-emerald-700 bg-emerald-950/40 p-4 hover:bg-emerald-950/60 transition-colors">
            <p className="text-emerald-400 font-semibold text-sm">
              🟢 {buyZoneCount} stock{buyZoneCount > 1 ? "s" : ""} in buy zone — check watchlist
            </p>
          </div>
        </Link>
      )}

      {/* ── Grand total ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-zinc-900 border-zinc-800 col-span-1">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Total Value — All Portfolios</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{grandTotal > 0 ? `$${fmt(grandTotal)}` : "—"}</p>
            {grandPnl !== 0 && (
              <p className={`text-sm mt-1 ${pnlColour(grandPnl)}`}>
                {grandPnl >= 0 ? "+" : ""}${fmt(Math.abs(grandPnl))} ({grandPnlPct >= 0 ? "+" : ""}{grandPnlPct.toFixed(1)}%) unrealised
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Watchlist</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{watchItems.length}</p>
            <p className={`text-sm mt-1 ${buyZoneCount > 0 ? "text-emerald-400" : "text-zinc-500"}`}>
              {buyZoneCount} in buy zone
            </p>
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-zinc-400 font-medium uppercase tracking-wide">Research Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{recentReports.length}</p>
            <p className="text-sm mt-1 text-zinc-500">
              {recentReports[0] ? `Last: ${recentReports[0].ticker}` : "None yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Per-portfolio breakdown ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* MY PORTFOLIO */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h2 className="font-semibold text-zinc-100">My Portfolio</h2>
            {myTotal > 0 && (
              <span className="text-sm text-zinc-400">
                <span className="font-medium text-zinc-100">${fmt(myTotal)}</span>
                {myCost > 0 && (
                  <span className={`ml-2 text-xs ${pnlColour(myPnl)}`}>
                    {myPnl >= 0 ? "+" : ""}{((myPnl / myCost) * 100).toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Personal equities */}
          {personal.count > 0 && (
            <Link href="/portfolio" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Equities</p>
                  <p className="text-xs text-zinc-500">{personal.count} holdings · {activePicks.length} active picks</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{personal.value > 0 ? `$${fmt(personal.value)}` : "—"}</p>
                  {personal.cost > 0 && personal.value > 0 && (
                    <p className={`text-xs ${pnlColour(personal.pnl)}`}>
                      {personal.pnl >= 0 ? "+" : ""}{((personal.pnl / personal.cost) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )}

          {/* Super */}
          {superAcc.count > 0 && (
            <Link href="/portfolio" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Superannuation</p>
                  <p className="text-xs text-zinc-500">{superAcc.count} fund{superAcc.count !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{superAcc.value > 0 ? `$${fmt(superAcc.value)}` : "—"}</p>
                  {superAcc.cost > 0 && superAcc.value > 0 && (
                    <p className={`text-xs ${pnlColour(superAcc.pnl)}`}>
                      {superAcc.pnl >= 0 ? "+" : ""}{((superAcc.pnl / superAcc.cost) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )}

          {/* My metals */}
          {myMetals.holdings.length > 0 && (
            <Link href="/metals" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                <div>
                  <p className="text-sm font-medium text-amber-400">◆ Metals</p>
                  <p className="text-xs text-zinc-500">{myMetals.oz.toFixed(4)} oz · {myMetals.holdings.map(m => m.metal).join(", ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{myMetals.value > 0 ? `$${fmt(myMetals.value)}` : "—"}</p>
                  {myMetals.cost > 0 && myMetals.value > 0 && (
                    <p className={`text-xs ${pnlColour(myMetals.pnl)}`}>
                      {myMetals.pnl >= 0 ? "+" : ""}{((myMetals.pnl / myMetals.cost) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )}

          {personal.count === 0 && superAcc.count === 0 && myMetals.holdings.length === 0 && (
            <p className="text-zinc-500 text-sm px-1">No holdings yet.</p>
          )}
        </div>

        {/* MAXWELL'S PORTFOLIO */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
            <h2 className="font-semibold text-zinc-100">Maxwell&apos;s Portfolio</h2>
            {mxTotal > 0 && (
              <span className="text-sm text-zinc-400">
                <span className="font-medium text-zinc-100">${fmt(mxTotal)}</span>
                {mxCost > 0 && (
                  <span className={`ml-2 text-xs ${pnlColour(mxPnl)}`}>
                    {mxPnl >= 0 ? "+" : ""}{((mxPnl / mxCost) * 100).toFixed(1)}%
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Maxwell equities */}
          {maxwell.count > 0 && (
            <Link href="/portfolio" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                <div>
                  <p className="text-sm font-medium text-zinc-200">Equities</p>
                  <p className="text-xs text-zinc-500">{maxwell.count} holding{maxwell.count !== 1 ? "s" : ""}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{maxwell.value > 0 ? `$${fmt(maxwell.value)}` : "—"}</p>
                  {maxwell.cost > 0 && maxwell.value > 0 && (
                    <p className={`text-xs ${pnlColour(maxwell.pnl)}`}>
                      {maxwell.pnl >= 0 ? "+" : ""}{((maxwell.pnl / maxwell.cost) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )}

          {/* Maxwell metals */}
          {mxMetals.holdings.length > 0 && (
            <Link href="/metals" className="block">
              <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-600 transition-colors">
                <div>
                  <p className="text-sm font-medium text-amber-400">◆ Metals</p>
                  <p className="text-xs text-zinc-500">{mxMetals.oz.toFixed(4)} oz · {mxMetals.holdings.map(m => m.metal).join(", ")}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{mxMetals.value > 0 ? `$${fmt(mxMetals.value)}` : "—"}</p>
                  {mxMetals.cost > 0 && mxMetals.value > 0 && (
                    <p className={`text-xs ${pnlColour(mxMetals.pnl)}`}>
                      {mxMetals.pnl >= 0 ? "+" : ""}{((mxMetals.pnl / mxMetals.cost) * 100).toFixed(1)}%
                    </p>
                  )}
                </div>
              </div>
            </Link>
          )}

          {maxwell.count === 0 && mxMetals.holdings.length === 0 && (
            <p className="text-zinc-500 text-sm px-1">No holdings yet.</p>
          )}
        </div>
      </div>

      {/* ── Investment Pipeline ──────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-zinc-100">Investment Pipeline</h2>
          <span className="text-xs text-zinc-500">Watchlist → Buy Zone → Action Alerts</span>
        </div>
        <div className="flex items-stretch gap-2">

          {/* Stage 1 — Watchlist */}
          <Link href="/watchlist" className="flex-1 block">
            <div className="h-full rounded-lg bg-zinc-900 border border-zinc-700 p-4 hover:border-zinc-500 transition-colors">
              <p className="text-xs text-zinc-500 uppercase tracking-wide font-medium mb-2">👁 Watchlist</p>
              <p className="text-3xl font-bold">{allWatchItems.length}</p>
              <p className="text-xs text-zinc-500 mt-1">stocks monitoring</p>
            </div>
          </Link>

          {/* Arrow */}
          <div className="flex items-center text-zinc-600 text-xl px-1 shrink-0">→</div>

          {/* Stage 2 — Buy Zone */}
          <Link href="/watchlist" className="flex-1 block">
            <div className={`h-full rounded-lg border p-4 transition-colors ${buyZoneCount > 0 ? "bg-emerald-950/40 border-emerald-700 hover:border-emerald-500" : "bg-zinc-900 border-zinc-700 hover:border-zinc-500"}`}>
              <p className={`text-xs uppercase tracking-wide font-medium mb-2 ${buyZoneCount > 0 ? "text-emerald-400" : "text-zinc-500"}`}>🟢 Buy Zone</p>
              <p className="text-3xl font-bold">{buyZoneCount}</p>
              <p className={`text-xs mt-1 ${buyZoneCount > 0 ? "text-emerald-500" : "text-zinc-500"}`}>
                {buyZoneCount > 0 ? "at or below target price" : "none at target price"}
              </p>
            </div>
          </Link>

          {/* Arrow */}
          <div className="flex items-center text-zinc-600 text-xl px-1 shrink-0">→</div>

          {/* Stage 3 — Action Alerts */}
          <Link href="/picks" className="flex-1 block">
            <div className={`h-full rounded-lg border p-4 transition-colors ${allPicks.length > 0 ? "bg-amber-950/30 border-amber-700 hover:border-amber-500" : "bg-zinc-900 border-zinc-700 hover:border-zinc-500"}`}>
              <p className={`text-xs uppercase tracking-wide font-medium mb-2 ${allPicks.length > 0 ? "text-amber-400" : "text-zinc-500"}`}>🔔 Action Alerts</p>
              <p className="text-3xl font-bold">{allPicks.length}</p>
              <p className={`text-xs mt-1 ${allPicks.length > 0 ? "text-amber-500" : "text-zinc-500"}`}>
                {allPicks.filter(p => p.status === "watching").length} buy · {activePicks.length} held
              </p>
            </div>
          </Link>

        </div>
      </div>

      {/* ── Portfolio News Digest ────────────────────────────────────────── */}
      <NewsDigestPanel />

      {/* ── Research & Recent Watchlist ──────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Recent Research</CardTitle>
            <Link href="/research" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">View all →</Link>
          </CardHeader>
          <CardContent>
            {recentReports.length === 0 ? (
              <p className="text-zinc-500 text-sm">No reports yet. Ask Claude to analyse a stock.</p>
            ) : (
              <div className="space-y-1">
                {recentReports.map((r) => (
                  <Link key={r.id} href={`/research/${r.ticker}`} className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 transition-colors">
                    <div>
                      <span className="font-medium text-sm">{r.ticker}</span>
                      {r.companyName && <span className="text-zinc-500 text-xs ml-2">{r.companyName}</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.verdict && <Badge className={`text-xs capitalize ${verdictStyles[r.verdict] ?? "bg-zinc-700 text-zinc-300"}`}>{r.verdict}</Badge>}
                      <span className="text-zinc-500 text-xs">{r.reportDate}</span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Watchlist</CardTitle>
            <Link href="/watchlist" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">View all →</Link>
          </CardHeader>
          <CardContent>
            {allWatchItems.length === 0 ? (
              <p className="text-zinc-500 text-sm">No watchlist stocks yet.</p>
            ) : (
              <div className="space-y-1">
                {allWatchItems.slice(0, 6).map((w) => (
                  <Link key={w.id} href="/watchlist" className="flex items-center justify-between p-2 rounded hover:bg-zinc-800 transition-colors">
                    <div>
                      <span className="font-medium text-sm">{w.ticker}</span>
                      {w.companyName && <span className="text-zinc-500 text-xs ml-2">{w.companyName}</span>}
                    </div>
                    {w.intrinsicValue && <span className="text-zinc-400 text-xs">IV ${w.intrinsicValue.toFixed(2)}</span>}
                  </Link>
                ))}
                {allWatchItems.length > 6 && <p className="text-zinc-500 text-xs pt-1">+{allWatchItems.length - 6} more</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
