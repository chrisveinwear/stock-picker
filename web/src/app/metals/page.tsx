"use client";
import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MetalHolding = {
  id: string;
  metal: string;
  label: string | null;
  ounces: number;
  avgCostAud: number | null;
  location: string | null;
  storageType: string | null;
  purchaseDate: string | null;
  account: string | null;
  notes: string | null;
};

type MetalTransaction = {
  id: number;
  metal: string;
  type: string;
  date: string;
  ounces: number;
  pricePerOzAud: number | null;
  feeAud: number | null;
  totalAud: number | null;
  avgCostAudAfter: number | null;
  realizedGainAud: number | null;
  account: string | null;
  source: string | null;
  orderId: string | null;
  notes: string | null;
};

const ACCOUNT_LABELS: Record<string, string> = {
  personal: "My Holdings",
  maxwell: "Maxwell's Holdings",
};
const ACCOUNT_ORDER = ["personal", "maxwell"];

type MetalPrices = {
  goldUsd: number;
  goldAud: number;
  silverUsd: number;
  silverAud: number;
  audUsd: number;
  goldSilverRatio: number;
  goldChangePercent: number | null;
  silverChangePercent: number | null;
  fetchedAt: string;
};

const METAL_SPOT: Record<string, keyof MetalPrices> = {
  gold: "goldAud",
  silver: "silverAud",
};

const STORAGE_LABELS: Record<string, string> = {
  unallocated: "Unallocated",
  allocated: "Allocated",
  certificate: "Certificate",
  coin: "Coins/Bars",
};

const METAL_COLOURS: Record<string, string> = {
  gold: "text-amber-400",
  silver: "text-zinc-300",
  platinum: "text-cyan-300",
  palladium: "text-purple-300",
};

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-AU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function MetalsPage() {
  const [prices, setPrices]     = useState<MetalPrices | null>(null);
  const [holdings, setHoldings] = useState<MetalHolding[]>([]);
  const [loading, setLoading]   = useState(true);
  const [transactions, setTransactions] = useState<MetalTransaction[]>([]);
  const [showHistory, setShowHistory] = useState<Record<string, boolean>>({});
  const [showAddTx, setShowAddTx] = useState(false);
  const [txForm, setTxForm] = useState({
    account: "personal", metal: "gold", type: "buy",
    date: "", ounces: "", pricePerOzAud: "", feeAud: "0", notes: "",
  });

  const load = useCallback(async () => {
    const [hRes, pRes, tRes] = await Promise.all([
      fetch("/api/metals"),
      fetch("/api/metals/prices"),
      fetch("/api/metals/transactions"),
    ]);
    setHoldings(await hRes.json());
    setPrices(await pRes.json());
    setTransactions(await tRes.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddTransaction(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      metal: txForm.metal,
      type: txForm.type,
      date: txForm.date,
      ounces: parseFloat(txForm.ounces),
      pricePerOzAud: parseFloat(txForm.pricePerOzAud) || null,
      feeAud: parseFloat(txForm.feeAud) || 0,
      notes: txForm.notes || null,
    };
    const url = txForm.account === "maxwell" ? "/api/metals/transactions/maxwell-mirror" : "/api/metals/transactions";
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(txForm.account === "maxwell" ? payload : { ...payload, account: "personal" }),
    });
    setShowAddTx(false);
    setTxForm({ account: "personal", metal: "gold", type: "buy", date: "", ounces: "", pricePerOzAud: "", feeAud: "0", notes: "" });
    load();
  }

  function spotForMetal(metal: string): number {
    if (!prices) return 0;
    const key = METAL_SPOT[metal];
    return key ? (prices[key] as number) : 0;
  }

  // Totals
  const metalsValue = holdings.reduce((s, h) => s + h.ounces * spotForMetal(h.metal), 0);

  // AUD/USD sensitivity — 5% AUD appreciation lowers gold's AUD price
  const audSensitivity = prices
    ? (() => {
        const newAudUsd = prices.audUsd * 1.05;
        // Re-derive AUD price using the same formula as the server: goldUsd / audUsd
        const newGoldAud = prices.audUsd > 0 ? prices.goldUsd / newAudUsd : prices.goldAud;
        const goldHoldings = holdings.filter(h => h.metal === "gold");
        const currentGoldValue = goldHoldings.reduce((s, h) => s + h.ounces * prices.goldAud, 0);
        const newGoldValue = goldHoldings.reduce((s, h) => s + h.ounces * newGoldAud, 0);
        return newGoldValue - currentGoldValue;
      })()
    : null;

  const changeColour = (pct: number | null) =>
    pct == null ? "" : pct >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Metals</h1>
          <p className="text-zinc-400 text-sm mt-1">Physical precious metals holdings</p>
        </div>
        <Button onClick={() => setShowAddTx(!showAddTx)} variant="outline" className="border-zinc-700 text-zinc-300">
          {showAddTx ? "Cancel" : "+ Add Transaction"}
        </Button>
      </div>

      {/* Spot price ticker strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          {
            label: "Gold (AUD/oz)", value: prices ? `$${fmt(prices.goldAud, 0)}` : "—",
            sub: prices?.goldChangePercent != null ? `${prices.goldChangePercent >= 0 ? "+" : ""}${fmt(prices.goldChangePercent)}% today` : null,
            subColour: changeColour(prices?.goldChangePercent ?? null),
            usd: prices ? `US$${fmt(prices.goldUsd, 0)}/oz` : null,
          },
          {
            label: "Silver (AUD/oz)", value: prices ? `$${fmt(prices.silverAud, 2)}` : "—",
            sub: prices?.silverChangePercent != null ? `${prices.silverChangePercent >= 0 ? "+" : ""}${fmt(prices.silverChangePercent)}% today` : null,
            subColour: changeColour(prices?.silverChangePercent ?? null),
            usd: prices ? `US$${fmt(prices.silverUsd, 2)}/oz` : null,
          },
          {
            label: "AUD/USD", value: prices ? prices.audUsd.toFixed(4) : "—",
            sub: "Exchange rate", subColour: "text-zinc-500", usd: null,
          },
          {
            label: "Gold/Silver Ratio", value: prices ? `${fmt(prices.goldSilverRatio, 1)}×` : "—",
            sub: "oz of silver per oz of gold", subColour: "text-zinc-500", usd: null,
          },
        ].map((c) => (
          <Card key={c.label} className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wide">{c.label}</p>
              <p className="text-xl font-bold mt-1">{c.value}</p>
              {c.usd && <p className="text-xs text-zinc-500 mt-0.5">{c.usd}</p>}
              {c.sub && <p className={`text-xs mt-0.5 ${c.subColour}`}>{c.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add Transaction form */}
      {showAddTx && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader>
            <CardTitle className="text-sm">Add Transaction</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddTransaction} className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-zinc-400 uppercase tracking-wide">Portfolio</Label>
                <div className="flex gap-2">
                  {[
                    { value: "personal", label: "My Holdings" },
                    { value: "maxwell",  label: "Maxwell" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setTxForm({ ...txForm, account: opt.value })}
                      className={`px-4 py-1.5 rounded-md text-sm font-medium border transition-colors ${
                        txForm.account === opt.value
                          ? "bg-zinc-700 border-zinc-500 text-zinc-100"
                          : "bg-zinc-800/50 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {txForm.account === "maxwell" && (
                  <p className="text-xs text-zinc-500">
                    Maxwell has no Perth Mint account of his own — this will automatically record an identical mirror transaction in My Holdings (opposite type, same date/oz/price), since both share the one physical balance.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Type</Label>
                  <select value={txForm.type} onChange={e => setTxForm({ ...txForm, type: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 h-8 text-sm rounded px-2">
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Metal</Label>
                  <select value={txForm.metal} onChange={e => setTxForm({ ...txForm, metal: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 text-zinc-100 h-8 text-sm rounded px-2">
                    <option value="gold">Gold</option>
                    <option value="silver">Silver</option>
                    <option value="platinum">Platinum</option>
                    <option value="palladium">Palladium</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Date</Label>
                  <Input type="date" required value={txForm.date}
                    onChange={e => setTxForm({ ...txForm, date: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Troy Ounces (oz t)</Label>
                  <Input type="number" step="0.00001" required value={txForm.ounces}
                    onChange={e => setTxForm({ ...txForm, ounces: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Price AUD/oz</Label>
                  <Input type="number" step="0.01" required value={txForm.pricePerOzAud}
                    onChange={e => setTxForm({ ...txForm, pricePerOzAud: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-zinc-400">Fee AUD</Label>
                  <Input type="number" step="0.01" value={txForm.feeAud}
                    onChange={e => setTxForm({ ...txForm, feeAud: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
                <div className="space-y-1 col-span-2">
                  <Label className="text-xs text-zinc-400">Notes</Label>
                  <Input value={txForm.notes} onChange={e => setTxForm({ ...txForm, notes: e.target.value })}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm" />
                </div>
              </div>

              {/* Live mirror preview — Maxwell's counterpart in My Holdings */}
              {txForm.account === "maxwell" && (
                <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-950/50 p-3 space-y-1">
                  <p className="text-xs text-zinc-400 uppercase tracking-wide">Mirror transaction — My Holdings</p>
                  <p className="text-sm text-zinc-300">
                    <span className={txForm.type === "buy" ? "text-red-400" : "text-emerald-400"}>
                      {txForm.type === "buy" ? "Sell" : "Buy"}
                    </span>
                    {" "}{txForm.ounces || "—"} oz t {txForm.metal}
                    {txForm.pricePerOzAud ? ` @ $${txForm.pricePerOzAud}/oz` : ""}
                    {txForm.date ? ` on ${txForm.date}` : ""}
                    {" "}· fee $0.00
                  </p>
                </div>
              )}

              <div className="col-span-full flex gap-2">
                <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100">
                  Add Transaction
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Holdings table */}
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : holdings.length === 0 ? (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardContent className="pt-6 text-center text-zinc-500 text-sm">
            No metal holdings yet. Click “+ Add Transaction” to record your Perth Mint gold.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {ACCOUNT_ORDER.filter(acct => holdings.some(h => (h.account ?? "personal") === acct)).map(acct => {
            const group = holdings.filter(h => (h.account ?? "personal") === acct);
            const groupValue = group.reduce((s, h) => s + h.ounces * spotForMetal(h.metal), 0);
            const groupCost  = group.reduce((s, h) => s + (h.avgCostAud ? h.ounces * h.avgCostAud : 0), 0);
            const groupPnl   = groupValue - groupCost;
            const groupPnlPct = groupCost > 0 ? (groupPnl / groupCost) * 100 : 0;
            return (
              <div key={acct} className="space-y-2">
                {/* Account section header */}
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wide">
                    {ACCOUNT_LABELS[acct] ?? acct}
                  </h2>
                  {groupCost > 0 && (
                    <span className="text-xs text-zinc-500">
                      ${fmt(groupValue, 0)} value ·{" "}
                      <span className={groupPnl >= 0 ? "text-emerald-400" : "text-red-400"}>
                        {groupPnl >= 0 ? "+" : ""}{fmt(groupPnlPct, 1)}%
                      </span>
                    </span>
                  )}
                </div>

                {group.map((h) => {
                  const spot   = spotForMetal(h.metal);
                  const value  = spot > 0 ? h.ounces * spot : null;
                  const cost   = h.avgCostAud ? h.ounces * h.avgCostAud : null;
                  const pnl    = value != null && cost != null ? value - cost : null;
                  const pnlPct = pnl != null && cost != null ? (pnl / cost) * 100 : null;
                  return (
                    <div key={h.id} className="flex items-start justify-between p-4 rounded-lg border border-zinc-800 bg-zinc-900">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-semibold capitalize ${METAL_COLOURS[h.metal] ?? "text-zinc-100"}`}>
                            {h.metal}
                          </span>
                          {h.label && <span className="text-zinc-400 text-sm">{h.label}</span>}
                          {h.storageType && (
                            <span className="text-xs bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-700">
                              {STORAGE_LABELS[h.storageType] ?? h.storageType}
                            </span>
                          )}
                          {h.location && <span className="text-xs text-zinc-500">{h.location}</span>}
                        </div>
                        <p className="text-zinc-500 text-xs">
                          {fmt(h.ounces, 4)} oz t
                          {h.avgCostAud ? ` · avg cost $${fmt(h.avgCostAud, 2)}/oz` : ""}
                          {spot > 0 ? ` · spot $${fmt(spot, 0)}/oz` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        {cost != null && (
                          <div className="text-right">
                            <p className="text-xs text-zinc-400">Cost</p>
                            <p className="font-medium">${fmt(cost, 0)}</p>
                          </div>
                        )}
                        {value != null && (
                          <div className="text-right">
                            <p className="text-xs text-zinc-400" title="Estimated from COMEX gold futures converted to AUD — not Perth Mint's live buy/sell price, which typically differs by 1-2%">Value (est.)</p>
                            <p className="font-medium">${fmt(value, 0)}</p>
                          </div>
                        )}
                        {pnlPct != null && (
                          <div className="text-right">
                            <p className="text-xs text-zinc-400">P&L</p>
                            <p className={`font-medium ${pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {pnlPct >= 0 ? "+" : ""}{fmt(pnlPct, 1)}%
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {/* Transaction history toggle */}
                {transactions.some(t => (t.account ?? "personal") === acct) && (
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowHistory(s => ({ ...s, [acct]: !s[acct] }))}
                      className="text-xs text-zinc-500 hover:text-zinc-300 underline underline-offset-2"
                    >
                      {showHistory[acct] ? "Hide" : "Show"} transaction history
                      ({transactions.filter(t => (t.account ?? "personal") === acct).length})
                    </button>
                    {showHistory[acct] && (
                      <div className="mt-2 overflow-x-auto rounded-lg border border-zinc-800">
                        <table className="w-full text-xs">
                          <thead className="bg-zinc-900 text-zinc-500 uppercase tracking-wide">
                            <tr>
                              <th className="text-left font-medium px-3 py-2">Date</th>
                              <th className="text-left font-medium px-3 py-2">Type</th>
                              <th className="text-right font-medium px-3 py-2">Oz</th>
                              <th className="text-right font-medium px-3 py-2">Price/oz</th>
                              <th className="text-right font-medium px-3 py-2">Fee</th>
                              <th className="text-right font-medium px-3 py-2">Total</th>
                              <th className="text-right font-medium px-3 py-2">Realized G/L</th>
                              <th className="text-left font-medium px-3 py-2">Source</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.filter(t => (t.account ?? "personal") === acct).map(t => (
                              <tr key={t.id} className="border-t border-zinc-800 text-zinc-300">
                                <td className="px-3 py-1.5 whitespace-nowrap">{t.date}</td>
                                <td className={`px-3 py-1.5 capitalize ${t.type === "buy" ? "text-emerald-400" : "text-red-400"}`}>{t.type}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">{fmt(Math.abs(t.ounces), 4)}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">{t.pricePerOzAud != null ? `$${fmt(t.pricePerOzAud, 2)}` : "—"}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">{t.feeAud != null ? `$${fmt(t.feeAud, 2)}` : "—"}</td>
                                <td className="px-3 py-1.5 text-right whitespace-nowrap">{t.totalAud != null ? `${t.totalAud < 0 ? "-" : ""}$${fmt(Math.abs(t.totalAud), 2)}` : "—"}</td>
                                <td className={`px-3 py-1.5 text-right whitespace-nowrap ${t.realizedGainAud == null ? "" : t.realizedGainAud >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {t.realizedGainAud != null ? `${t.realizedGainAud >= 0 ? "+" : ""}$${fmt(t.realizedGainAud, 2)}` : "—"}
                                </td>
                                <td className="px-3 py-1.5 text-zinc-500 whitespace-nowrap">{t.source ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Analysis cards */}
      {holdings.length > 0 && prices && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Portfolio weight */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wide">Metals Value (est.)</p>
              <p className="text-xl font-bold mt-1">${fmt(metalsValue, 0)}</p>
              <p className="text-xs text-zinc-500 mt-1">
                Estimated from COMEX spot — no live Perth Mint price feed, so this can differ from your actual account value by 1-2%. See Portfolio page for total allocation weight across all accounts.
              </p>
            </CardContent>
          </Card>

          {/* AUD/USD sensitivity */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wide">AUD/USD Sensitivity</p>
              <p className={`text-xl font-bold mt-1 ${audSensitivity != null && audSensitivity < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {audSensitivity != null ? `${audSensitivity >= 0 ? "+" : ""}$${fmt(audSensitivity, 0)}` : "—"}
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                If AUD rises 5% to {(prices.audUsd * 1.05).toFixed(4)}, gold value changes by this amount in AUD
              </p>
            </CardContent>
          </Card>

          {/* Replacement cost */}
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-4">
              <p className="text-xs text-zinc-400 uppercase tracking-wide">Replacement Cost</p>
              {(() => {
                const goldHoldings = holdings.filter(h => h.metal === "gold" && h.avgCostAud);
                if (!goldHoldings.length) return <p className="text-xl font-bold mt-1">—</p>;
                const totalCostSpent = goldHoldings.reduce((s, h) => s + (h.avgCostAud! * h.ounces), 0);
                const ozAtSpot = prices.goldAud > 0 ? totalCostSpent / prices.goldAud : 0;
                const totalOz  = goldHoldings.reduce((s, h) => s + h.ounces, 0);
                return (
                  <>
                    <p className="text-xl font-bold mt-1">{fmt(ozAtSpot, 4)} oz</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      Your gold cost ({fmt(totalOz, 4)} oz) buys {fmt(ozAtSpot, 4)} oz at today’s spot
                      {ozAtSpot < totalOz ? ` — ${fmt(((totalOz - ozAtSpot) / totalOz) * 100, 1)}% more oz when you bought` : ` — up ${fmt(((ozAtSpot - totalOz) / totalOz) * 100, 1)}%`}
                    </p>
                  </>
                );
              })()}
            </CardContent>
          </Card>
        </div>
      )}

      {prices && (
        <p className="text-xs text-zinc-600">
          Prices via COMEX futures (GC=F, SI=F) · Last updated {new Date(prices.fetchedAt).toLocaleTimeString("en-AU")} · 15-min cache ·
          {" "}Holding values are estimates — there’s no live Perth Mint price feed, so actual account value may differ by 1-2%.
        </p>
      )}
    </div>
  );
}
