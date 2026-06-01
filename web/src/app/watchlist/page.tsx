"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

type WatchItem = {
  id: number;
  ticker: string;
  companyName: string | null;
  sector: string | null;
  intrinsicValue: number | null;
  targetBuyPrice: number | null;
  marginOfSafetyThreshold: number | null;
  whyWatching: string | null;
  alertEnabled: boolean;
};

type Quote = {
  ticker: string;
  lastPrice: number;
  changePercent: number | null;
};

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: "", companyName: "", intrinsicValue: "", targetBuyPrice: "", whyWatching: "", sector: "" });

  async function load() {
    const res = await fetch("/api/watchlist");
    const data = await res.json();
    setItems(data);
    if (data.length) {
      const tickers = data.map((w: WatchItem) => w.ticker).join(",");
      const qRes = await fetch(`/api/prices?tickers=${tickers}`);
      const qData = await qRes.json();
      setQuotes(Object.fromEntries(qData.map((q: Quote) => [q.ticker, q])));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        intrinsicValue: form.intrinsicValue ? parseFloat(form.intrinsicValue) : null,
        targetBuyPrice: form.targetBuyPrice ? parseFloat(form.targetBuyPrice) : null,
      }),
    });
    setForm({ ticker: "", companyName: "", intrinsicValue: "", targetBuyPrice: "", whyWatching: "", sector: "" });
    setShowAdd(false);
    load();
  }

  async function handleRemove(id: number) {
    await fetch(`/api/watchlist/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Watchlist</h1>
          <p className="text-zinc-400 text-sm mt-1">Stocks to monitor — alerts when margin of safety threshold is hit</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} variant="outline" className="border-zinc-700 text-zinc-300">
          {showAdd ? "Cancel" : "+ Add Stock"}
        </Button>
      </div>

      {showAdd && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Add to Watchlist</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { key: "ticker", label: "Ticker (e.g. CBA.AX)", required: true },
                { key: "companyName", label: "Company Name" },
                { key: "sector", label: "Sector" },
                { key: "intrinsicValue", label: "Intrinsic Value (AUD)", type: "number" },
                { key: "targetBuyPrice", label: "Target Buy Price (AUD)", type: "number" },
                { key: "whyWatching", label: "Why Watching" },
              ].map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label className="text-xs text-zinc-400">{f.label}</Label>
                  <Input
                    type={f.type ?? "text"}
                    step="0.01"
                    value={(form as Record<string, string>)[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    required={f.required}
                    className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm"
                  />
                </div>
              ))}
              <div className="col-span-full">
                <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Add to Watchlist</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : items.length === 0 ? (
        <p className="text-zinc-500 text-sm">No stocks on watchlist yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((w) => {
            const q = quotes[w.ticker];
            const mos = q && w.intrinsicValue ? ((w.intrinsicValue - q.lastPrice) / w.intrinsicValue) * 100 : null;
            const inBuyZone = q && w.targetBuyPrice && q.lastPrice <= w.targetBuyPrice;
            return (
              <div key={w.id} className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${inBuyZone ? "border-emerald-700 bg-emerald-950/30" : "border-zinc-800 bg-zinc-900"}`}>
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{w.ticker}</span>
                      {inBuyZone && <Badge className="bg-emerald-900 text-emerald-300 text-xs">Buy Zone</Badge>}
                    </div>
                    {w.companyName && <p className="text-zinc-400 text-xs">{w.companyName}</p>}
                    {w.whyWatching && <p className="text-zinc-500 text-xs mt-0.5 max-w-xs">{w.whyWatching}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  {q ? (
                    <div className="text-right">
                      <p className="font-medium">${q.lastPrice.toFixed(2)}</p>
                      {q.changePercent != null && (
                        <p className={`text-xs ${q.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {q.changePercent >= 0 ? "+" : ""}{q.changePercent.toFixed(2)}%
                        </p>
                      )}
                    </div>
                  ) : <span className="text-zinc-500 text-xs">—</span>}
                  {w.intrinsicValue && <div className="text-right"><p className="text-xs text-zinc-400">IV</p><p className="font-medium">${w.intrinsicValue.toFixed(2)}</p></div>}
                  {w.targetBuyPrice && <div className="text-right"><p className="text-xs text-zinc-400">Target</p><p className="font-medium">${w.targetBuyPrice.toFixed(2)}</p></div>}
                  {mos != null && (
                    <div className="text-right">
                      <p className="text-xs text-zinc-400">MOS</p>
                      <p className={`font-medium ${mos >= 30 ? "text-emerald-400" : mos >= 0 ? "text-amber-400" : "text-red-400"}`}>{mos.toFixed(1)}%</p>
                    </div>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => handleRemove(w.id)} className="text-zinc-500 hover:text-red-400 h-7 text-xs">Remove</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
