"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type Holding = {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  shares: number;
  avgCost: number;
  account: string | null;
  source: string;
  manualPrice: number | null;
  priceType: string | null;
};

type Quote = { ticker: string; lastPrice: number; changePercent: number | null };

type MetalHolding = { id: number; metal: string; ounces: number; avgCostAud: number | null; label: string | null; account: string | null };
type MetalPrices = { goldAud: number; silverAud: number; audUsd: number };

const METAL_SPOT: Record<string, keyof MetalPrices> = { gold: "goldAud", silver: "silverAud" };

const ACCOUNT_LABELS: Record<string, string> = {
  personal: "My Portfolio",
  super: "Superannuation",
  maxwell: "Maxwell's Portfolio",
};

const ACCOUNT_ORDER = ["personal", "super", "maxwell"];

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: "", companyName: "", sector: "", shares: "", avgCost: "", manualPrice: "", account: "personal" });
  const [editingPrice, setEditingPrice] = useState<{ id: number; value: string } | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [metals, setMetals] = useState<MetalHolding[]>([]);
  const [metalPrices, setMetalPrices] = useState<MetalPrices | null>(null);

  async function load() {
    const [res, metalRes, metalPriceRes] = await Promise.all([
      fetch("/api/portfolio"),
      fetch("/api/metals"),
      fetch("/api/metals/prices"),
    ]);
    const data = await res.json();
    setHoldings(data);
    setMetals(await metalRes.json());
    const mp = await metalPriceRes.json();
    if (!mp.error) setMetalPrices(mp);

    const liveHoldings = data.filter((h: Holding) => h.priceType !== "manual");
    if (liveHoldings.length) {
      const tickers = liveHoldings.map((h: Holding) => h.ticker).join(",");
      const qRes = await fetch(`/api/prices?tickers=${tickers}`);
      const qData = await qRes.json();
      setQuotes(Object.fromEntries(qData.map((q: Quote) => [q.ticker, q])));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSync(portfolioId: string, account: string, label: string) {
    setSyncing(account);
    setSyncMsg(null);
    try {
      const res = await fetch(`/api/sharesight/sync?portfolioId=${portfolioId}&account=${account}`);
      const data = await res.json();
      if (data.ok) {
        setSyncMsg(`✓ Synced ${data.synced} holdings for ${label}`);
        load();
      } else if (data.error?.includes("invalid_grant") || data.error?.includes("refresh")) {
        setSyncMsg(`Re-authorisation needed — visit /api/sharesight/callback to reconnect Sharesight`);
      } else {
        setSyncMsg(`Sync failed: ${data.error}`);
      }
    } catch {
      setSyncMsg("Sync failed — check server logs");
    } finally {
      setSyncing(null);
    }
  }

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        shares: parseFloat(form.shares),
        avgCost: parseFloat(form.avgCost) || 0,
        manualPrice: form.manualPrice ? parseFloat(form.manualPrice) : null,
      }),
    });
    setForm({ ticker: "", companyName: "", sector: "", shares: "", avgCost: "", manualPrice: "", account: "personal" });
    setShowAdd(false);
    load();
  }

  async function handleRemove(id: number) {
    await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    load();
  }

  async function handleSaveManualPrice(id: number) {
    if (!editingPrice) return;
    await fetch(`/api/portfolio/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ manualPrice: parseFloat(editingPrice.value) }),
    });
    setEditingPrice(null);
    load();
  }

  function getPrice(h: Holding): number | null {
    if (h.priceType === "manual") return h.manualPrice ?? null;
    return quotes[h.ticker]?.lastPrice ?? null;
  }

  // Group holdings by account
  const byAccount: Record<string, Holding[]> = {};
  for (const h of holdings) {
    const acct = h.account ?? "personal";
    if (!byAccount[acct]) byAccount[acct] = [];
    byAccount[acct].push(h);
  }

  // Compute totals per account
  function accountTotals(list: Holding[]) {
    let cost = 0, value = 0;
    for (const h of list) {
      if (h.avgCost > 0) cost += h.avgCost * h.shares;
      const p = getPrice(h);
      if (p) value += p * h.shares;
    }
    return { cost, value, pnl: value - cost, pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : 0 };
  }

  // Metals totals
  function metalValue(m: MetalHolding) {
    if (!metalPrices) return 0;
    const key = METAL_SPOT[m.metal];
    return key ? m.ounces * (metalPrices[key] as number) : 0;
  }
  function accountMetalsValue(acct: string) {
    return metals.filter(m => (m.account ?? "personal") === acct).reduce((s, m) => s + metalValue(m), 0);
  }
  const metalsValue = metals.reduce((s, m) => s + metalValue(m), 0);
  const metalsCost = metals.reduce((s, m) => s + (m.avgCostAud ? m.ounces * m.avgCostAud : 0), 0);

  // Grand totals (all accounts + metals)
  const grandCost = holdings.reduce((s, h) => s + (h.avgCost > 0 ? h.avgCost * h.shares : 0), 0) + metalsCost;
  const grandValue = holdings.reduce((s, h) => { const p = getPrice(h); return s + (p ? p * h.shares : 0); }, 0) + metalsValue;
  const grandPnl = grandValue - grandCost;
  const grandPnlPct = grandCost > 0 ? (grandPnl / grandCost) * 100 : 0;

  // Weight denominator per account — super rolls up into "my" total so its
  // holdings show % of my whole portfolio, not 100% of super alone.
  const MY_ACCOUNTS = ["personal", "super"];
  const myEquitiesValue = MY_ACCOUNTS.reduce((s, a) => s + accountTotals(byAccount[a] ?? []).value, 0);
  const myPortfolioTotal = myEquitiesValue + accountMetalsValue("personal");
  function weightDenominator(acct: string) {
    if (MY_ACCOUNTS.includes(acct)) return myPortfolioTotal;
    return accountTotals(byAccount[acct] ?? []).value + accountMetalsValue(acct);
  }

  const accountsToShow = ACCOUNT_ORDER.filter((a) => byAccount[a]?.length);

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Portfolio</h1>
          <p className="text-zinc-400 text-sm mt-1">All accounts — synced from Sharesight</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => handleSync("515525", "personal", "My Portfolio + Super")}
            disabled={syncing !== null}
            variant="outline"
            className="border-zinc-700 text-zinc-400 text-sm"
          >
            {syncing === "personal" ? "Syncing…" : "↻ My Portfolio"}
          </Button>
          <Button
            onClick={() => handleSync("1280686", "maxwell", "Maxwell's Portfolio")}
            disabled={syncing !== null}
            variant="outline"
            className="border-zinc-700 text-zinc-400 text-sm"
          >
            {syncing === "maxwell" ? "Syncing…" : "↻ Maxwell"}
          </Button>
          <Button onClick={() => setShowAdd(!showAdd)} variant="outline" className="border-zinc-700 text-zinc-300">
            {showAdd ? "Cancel" : "+ Add"}
          </Button>
        </div>
      </div>

      {syncMsg && (
        <p className={`text-sm px-3 py-2 rounded border ${syncMsg.startsWith("✓") ? "text-emerald-400 border-emerald-900 bg-emerald-950/40" : "text-amber-400 border-amber-900 bg-amber-950/40"}`}>
          {syncMsg}
          {syncMsg.includes("/api/sharesight/callback") && (
            <a href="/api/sharesight/callback" target="_blank" className="ml-2 underline text-blue-400">Re-authorise →</a>
          )}
        </p>
      )}

      {/* Grand total summary */}
      {grandCost > 0 && (
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Cost Base", value: `$${grandCost.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` },
            { label: "Current Value", value: grandValue > 0 ? `$${grandValue.toLocaleString("en-AU", { maximumFractionDigits: 0 })}` : "Loading…" },
            {
              label: "Unrealised P&L",
              value: grandValue > 0 ? `${grandPnl >= 0 ? "+" : ""}$${Math.abs(grandPnl).toLocaleString("en-AU", { maximumFractionDigits: 0 })} (${grandPnlPct.toFixed(1)}%)` : "—",
              color: grandPnl >= 0 ? "text-emerald-400" : "text-red-400",
            },
          ].map((c) => (
            <Card key={c.label} className="bg-zinc-900 border-zinc-800">
              <CardHeader className="pb-2"><CardTitle className="text-xs text-zinc-400 font-medium uppercase tracking-wide">{c.label}</CardTitle></CardHeader>
              <CardContent><p className={`text-xl font-bold ${(c as { color?: string }).color ?? ""}`}>{c.value}</p></CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add holding form */}
      {showAdd && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Add Holding</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="space-y-4">
              {/* Portfolio selector — full width, always first */}
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400 uppercase tracking-wide">Portfolio</Label>
                <div className="flex gap-2">
                  {[
                    { value: "personal", label: "My Portfolio" },
                    { value: "super",    label: "Superannuation" },
                    { value: "maxwell",  label: "Maxwell" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, account: opt.value })}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        form.account === opt.value
                          ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                          : "bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Rest of the fields */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                  { key: "ticker", label: "Ticker / APIR (e.g. CBA.AX or FSF0581AU)", required: true },
                  { key: "companyName", label: "Company / Fund Name" },
                  { key: "sector", label: "Sector" },
                  { key: "shares", label: "Units / Shares", type: "number", required: true },
                  { key: "avgCost", label: "Avg Cost Per Unit (AUD, 0 if unknown)", type: "number" },
                  { key: "manualPrice", label: "Current Unit Price (managed funds)", type: "number" },
                ].map((f) => (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-xs text-zinc-400">{f.label}</Label>
                    <Input
                      type={f.type ?? "text"}
                      step="0.0001"
                      value={(form as Record<string, string>)[f.key]}
                      onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                      required={f.required}
                      className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm"
                    />
                  </div>
                ))}
                <div className="col-span-full">
                  <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100">
                    Add to {form.account === "personal" ? "My Portfolio" : form.account === "super" ? "Superannuation" : "Maxwell"}
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : holdings.length === 0 ? (
        <p className="text-zinc-500 text-sm">No holdings yet.</p>
      ) : (
        <>
        {accountsToShow.map((acct) => {
          const list = byAccount[acct] ?? [];
          const { cost, value: acctValue, pnl, pnlPct } = accountTotals(list);
          const acctTotalValue = acctValue + accountMetalsValue(acct);
          const wtDenom = weightDenominator(acct);
          return (
            <div key={acct} className="space-y-3">
              {/* Account section header */}
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">
                  {ACCOUNT_LABELS[acct] ?? acct}
                </h2>
                {cost > 0 && (
                  <span className="text-xs text-zinc-500">
                    {acctValue > 0 ? `$${acctValue.toLocaleString("en-AU", { maximumFractionDigits: 0 })} value` : ""}
                    {acctValue > 0 && cost > 0 ? ` · ` : ""}
                    {cost > 0 ? (
                      <span className={pnl >= 0 ? "text-emerald-500" : "text-red-500"}>
                        {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%
                      </span>
                    ) : null}
                  </span>
                )}
              </div>

              {list.map((h) => {
                const price = getPrice(h);
                const value = price != null ? price * h.shares : null;
                const cost = h.avgCost > 0 ? h.avgCost * h.shares : null;
                const pnl = value != null && cost != null ? value - cost : null;
                const pnlPct = pnl != null && cost != null ? (pnl / cost) * 100 : null;
                const weight = value != null && wtDenom > 0 ? (value / wtDenom) * 100 : null;
                const isManual = h.priceType === "manual";
                return (
                  <div key={h.id} className="flex items-start justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{h.ticker}</span>
                        {h.companyName && <span className="text-zinc-400 text-sm">{h.companyName}</span>}
                        {h.sector && <span className="text-zinc-500 text-xs">{h.sector}</span>}
                        {isManual && <span className="text-xs text-amber-500 bg-amber-950 px-1.5 py-0.5 rounded">manual price</span>}
                      </div>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        {h.shares.toLocaleString("en-AU", { maximumFractionDigits: 4 })} units
                        {h.avgCost > 0 ? ` @ $${h.avgCost.toFixed(4)} avg` : ""}
                      </p>
                      {isManual && (
                        <div className="mt-2 flex items-center gap-2">
                          {editingPrice?.id === h.id ? (
                            <>
                              <Input
                                type="number"
                                step="0.0001"
                                value={editingPrice.value}
                                onChange={(e) => setEditingPrice({ id: h.id, value: e.target.value })}
                                className="bg-zinc-800 border-zinc-700 text-zinc-100 h-7 text-xs w-28"
                              />
                              <Button size="sm" onClick={() => handleSaveManualPrice(h.id)} className="h-7 text-xs bg-zinc-700 hover:bg-zinc-600">Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditingPrice(null)} className="h-7 text-xs text-zinc-500">Cancel</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="ghost" onClick={() => setEditingPrice({ id: h.id, value: String(h.manualPrice ?? "") })} className="h-7 text-xs text-zinc-500 hover:text-zinc-200 px-0">
                              {h.manualPrice ? `Unit price: $${h.manualPrice.toFixed(4)} — update` : "Set current unit price"}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-5 text-sm">
                      {price != null && <div className="text-right"><p className="text-xs text-zinc-400">Price</p><p className="font-medium">${price.toFixed(isManual ? 4 : 2)}</p></div>}
                      {cost != null && <div className="text-right"><p className="text-xs text-zinc-400">Cost</p><p className="font-medium">${cost.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</p></div>}
                      {value != null && <div className="text-right"><p className="text-xs text-zinc-400">Value</p><p className="font-medium">${value.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</p></div>}
                      {pnlPct != null && (
                        <div className="text-right">
                          <p className="text-xs text-zinc-400">P&L</p>
                          <p className={`font-medium ${pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%</p>
                        </div>
                      )}
                      {weight != null && <div className="text-right"><p className="text-xs text-zinc-400">Weight</p><p className="font-medium">{weight.toFixed(1)}%</p></div>}
                      <Button variant="ghost" size="sm" onClick={() => handleRemove(h.id)} className="text-zinc-500 hover:text-red-400 h-7 text-xs">Remove</Button>
                    </div>
                  </div>
                );
              })}

              {/* Metals for this account */}
              {(() => {
                const acctMetals = metals.filter(m => (m.account ?? "personal") === acct);
                if (acctMetals.length === 0) return null;
                const mv = acctMetals.reduce((s, m) => s + metalValue(m), 0);
                const mc = acctMetals.reduce((s, m) => s + (m.avgCostAud ? m.ounces * m.avgCostAud : 0), 0);
                const mPnlPct = mc > 0 ? ((mv - mc) / mc) * 100 : null;
                const mWeight = wtDenom > 0 ? (mv / wtDenom) * 100 : null;
                return (
                  <a href="/metals" className="flex items-start justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-amber-400">◆ Metals</span>
                        <span className="text-zinc-400 text-sm">Physical precious metals</span>
                      </div>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        {acctMetals.reduce((s, m) => s + m.ounces, 0).toFixed(4)} oz · {acctMetals.length} holding{acctMetals.length !== 1 ? "s" : ""} · View details →
                      </p>
                    </div>
                    <div className="flex items-center gap-5 text-sm">
                      {mc > 0 && <div className="text-right"><p className="text-xs text-zinc-400">Cost</p><p className="font-medium">${mc.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</p></div>}
                      {mv > 0 && <div className="text-right"><p className="text-xs text-zinc-400">Value</p><p className="font-medium">${mv.toLocaleString("en-AU", { maximumFractionDigits: 0 })}</p></div>}
                      {mPnlPct != null && <div className="text-right"><p className="text-xs text-zinc-400">P&L</p><p className={`font-medium ${mPnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{mPnlPct >= 0 ? "+" : ""}{mPnlPct.toFixed(1)}%</p></div>}
                      {mWeight != null && <div className="text-right"><p className="text-xs text-zinc-400">Weight</p><p className="font-medium">{mWeight.toFixed(1)}%</p></div>}
                    </div>
                  </a>
                );
              })()}
            </div>
          );
        })}

        {/* Metals not associated with any shown account (fallback) */}
        {metals.filter(m => !accountsToShow.includes(m.account ?? "personal")).length > 0 && (
          <div className="space-y-3">
            <div className="border-b border-zinc-800 pb-2">
              <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">◆ Metals (Other)</h2>
            </div>
            <a href="/metals" className="flex items-start justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900 hover:border-zinc-600 transition-colors">
              <span className="text-zinc-400 text-sm">View details →</span>
            </a>
          </div>
        )}
</>
      )}
    </div>
  );
}
