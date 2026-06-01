"use client";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Pick = {
  id: number;
  ticker: string;
  companyName: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  thesis: string | null;
  moatType: string | null;
  status: string;
  boughtDate: string | null;
  soldDate: string | null;
  soldPrice: number | null;
};

type Quote = { ticker: string; lastPrice: number; changePercent: number | null };

const statusStyles: Record<string, string> = {
  watching: "bg-zinc-700 text-zinc-300",
  bought: "bg-blue-900 text-blue-300",
  sold: "bg-zinc-800 text-zinc-400",
};

export default function PicksPage() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: "", companyName: "", entryPrice: "", targetPrice: "", thesis: "", moatType: "", status: "watching" });

  async function load() {
    const res = await fetch("/api/picks");
    const data = await res.json();
    setPicks(data);
    const active = data.filter((p: Pick) => p.status !== "sold");
    if (active.length) {
      const tickers = active.map((p: Pick) => p.ticker).join(",");
      const qRes = await fetch(`/api/prices?tickers=${tickers}`);
      const qData = await qRes.json();
      setQuotes(Object.fromEntries(qData.map((q: Quote) => [q.ticker, q])));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await fetch("/api/picks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        entryPrice: form.entryPrice ? parseFloat(form.entryPrice) : null,
        targetPrice: form.targetPrice ? parseFloat(form.targetPrice) : null,
      }),
    });
    setForm({ ticker: "", companyName: "", entryPrice: "", targetPrice: "", thesis: "", moatType: "", status: "watching" });
    setShowAdd(false);
    load();
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Action Alerts</h1>
          <p className="text-zinc-400 text-sm mt-1">Buy and sell alerts based on your valuation criteria</p>
        </div>
        <Button onClick={() => setShowAdd(!showAdd)} variant="outline" className="border-zinc-700 text-zinc-300">
          {showAdd ? "Cancel" : "+ New Pick"}
        </Button>
      </div>

      {showAdd && (
        <Card className="bg-zinc-900 border-zinc-800">
          <CardHeader><CardTitle className="text-sm">Add Stock Pick</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleAdd} className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {[
                { key: "ticker", label: "Ticker (e.g. CBA.AX)", required: true },
                { key: "companyName", label: "Company Name" },
                { key: "entryPrice", label: "Entry Price (AUD)", type: "number" },
                { key: "targetPrice", label: "Intrinsic Value / Target (AUD)", type: "number" },
                { key: "moatType", label: "Moat Type" },
                { key: "thesis", label: "Thesis (2-3 sentences)" },
              ].map((f) => (
                <div key={f.key} className={`space-y-1 ${f.key === "thesis" ? "col-span-full" : ""}`}>
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
              <div className="space-y-1">
                <Label className="text-xs text-zinc-400">Status</Label>
                <Select value={form.status} onValueChange={(v: string | null) => setForm({ ...form, status: v ?? "watching" })}>
                  <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-100 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-800 border-zinc-700">
                    <SelectItem value="watching">Watching</SelectItem>
                    <SelectItem value="bought">Bought</SelectItem>
                    <SelectItem value="sold">Sold</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-full">
                <Button type="submit" className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100">Save Pick</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-zinc-500 text-sm">Loading...</p>
      ) : picks.length === 0 ? (
        <p className="text-zinc-500 text-sm">No picks yet.</p>
      ) : (
        <div className="space-y-2">
          {picks.map((p) => {
            const q = quotes[p.ticker];
            const gainPct = q && p.entryPrice ? ((q.lastPrice - p.entryPrice) / p.entryPrice) * 100 : null;
            const mosPct = q && p.targetPrice ? ((p.targetPrice - q.lastPrice) / p.targetPrice) * 100 : null;
            return (
              <div key={p.id} className="p-4 rounded-lg border border-zinc-800 bg-zinc-900">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{p.ticker}</span>
                      {p.companyName && <span className="text-zinc-400 text-sm">{p.companyName}</span>}
                      <Badge className={`text-xs capitalize ${statusStyles[p.status] ?? "bg-zinc-700 text-zinc-300"}`}>{p.status}</Badge>
                      {p.moatType && <Badge className="bg-zinc-800 text-zinc-400 text-xs">{p.moatType}</Badge>}
                    </div>
                    {p.thesis && <p className="text-zinc-400 text-sm max-w-xl">{p.thesis}</p>}
                  </div>
                  <div className="flex items-center gap-5 text-sm shrink-0 ml-4">
                    {p.entryPrice && <div className="text-right"><p className="text-xs text-zinc-400">Entry</p><p className="font-medium">${p.entryPrice.toFixed(2)}</p></div>}
                    {q && <div className="text-right"><p className="text-xs text-zinc-400">Now</p><p className="font-medium">${q.lastPrice.toFixed(2)}</p></div>}
                    {p.targetPrice && <div className="text-right"><p className="text-xs text-zinc-400">IV</p><p className="font-medium">${p.targetPrice.toFixed(2)}</p></div>}
                    {gainPct != null && (
                      <div className="text-right">
                        <p className="text-xs text-zinc-400">Return</p>
                        <p className={`font-medium ${gainPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%</p>
                      </div>
                    )}
                    {mosPct != null && (
                      <div className="text-right">
                        <p className="text-xs text-zinc-400">MOS</p>
                        <p className={`font-medium ${mosPct >= 30 ? "text-emerald-400" : mosPct >= 0 ? "text-amber-400" : "text-red-400"}`}>{mosPct.toFixed(1)}%</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
