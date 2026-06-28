"use client";
import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PriceRangeChart, { LensPrice } from "@/components/PriceRangeChart";
import Link from "next/link";

type ResearchAlert = {
  watchlistId: number;
  ticker: string;
  companyName: string | null;
  verdict: string | null;
  reportDate: string;
  buyBelow: number;
  sellAbove: number;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  currentPrice: number | null;
  changePercent: number | null;
  zone: "buy" | "hold" | "sell" | "unknown";
  priceLenses: LensPrice[] | null;
  consensusBuyBelow: number;
  consensusSellAbove: number;
  isCommodity: boolean;
  currency: string;
};

type Pick = {
  id: number;
  ticker: string;
  companyName: string | null;
  entryPrice: number | null;
  targetPrice: number | null;
  thesis: string | null;
  moatType: string | null;
  status: string;
};

type Quote = { ticker: string; lastPrice: number; changePercent: number | null };

const zoneStyles = {
  buy: "border-emerald-700 bg-emerald-950/30",
  hold: "border-zinc-800 bg-zinc-900",
  sell: "border-red-900 bg-red-950/20",
  unknown: "border-zinc-800 bg-zinc-900",
};

const zoneBadge = {
  buy: "bg-emerald-900 text-emerald-300",
  hold: "bg-zinc-700 text-zinc-300",
  sell: "bg-red-900 text-red-300",
  unknown: "bg-zinc-800 text-zinc-400",
};

const verdictBadge: Record<string, string> = {
  buy: "bg-emerald-900 text-emerald-300",
  watch: "bg-amber-900 text-amber-300",
  avoid: "bg-red-900 text-red-300",
  hold: "bg-blue-900 text-blue-300",
};

const pickStatusStyles: Record<string, string> = {
  watching: "bg-zinc-700 text-zinc-300",
  bought: "bg-blue-900 text-blue-300",
  sold: "bg-zinc-800 text-zinc-400",
};

export default function ActionAlertsPage() {
  const [alerts, setAlerts] = useState<ResearchAlert[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [picks, setPicks] = useState<Pick[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [picksLoading, setPicksLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    ticker: "", companyName: "", entryPrice: "", targetPrice: "",
    thesis: "", moatType: "", status: "watching",
  });

  const loadAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/research/alerts");
      setAlerts(await res.json());
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  const loadPicks = useCallback(async () => {
    try {
      const res = await fetch("/api/picks");
      const data: Pick[] = await res.json();
      setPicks(data);
      const active = data.filter((p) => p.status !== "sold");
      if (active.length) {
        const tickers = active.map((p) => p.ticker).join(",");
        const qRes = await fetch(`/api/prices?tickers=${tickers}`);
        const qData: Quote[] = await qRes.json();
        setQuotes(Object.fromEntries(qData.map((q) => [q.ticker, q])));
      }
    } finally {
      setPicksLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    loadPicks();
    const timer = setInterval(() => { loadAlerts(); loadPicks(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [loadAlerts, loadPicks]);

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
    loadPicks();
  }

  async function handleRemoveFromWatchList(watchlistId: number) {
    // Removes the stock from the watch list and clears its action alerts.
    // The research report (markdown + history) is kept.
    await fetch(`/api/watchlist/${watchlistId}`, { method: "DELETE" });
    await loadAlerts();
  }

  const fmt = (v: number, currency = "AU$") =>
    `${currency}${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;

  return (
    <div className="space-y-8 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold">Watch List</h1>
        <p className="text-zinc-400 text-sm mt-1">Research-based buy/sell zones with live price indicators</p>
      </div>

      {/* ── Research-Based Alerts ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-end">
          <span className="text-xs text-zinc-500">
            {alertsLoading ? "Loading…" : `${alerts.length} report${alerts.length !== 1 ? "s" : ""} with price zones`}
          </span>
        </div>

        {alertsLoading ? (
          <p className="text-zinc-500 text-sm">Loading research alerts…</p>
        ) : alerts.length === 0 ? (
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="pt-5">
              <p className="text-zinc-400 text-sm">No research reports with price zones yet.</p>
              <p className="text-zinc-500 text-xs mt-1">
                Generate a new report — Claude will analyse each lens and set consensus buy/sell prices automatically.{" "}
                <Link href="/research" className="text-zinc-400 underline">Go to Research</Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {alerts.map((a) => (
              <Card key={a.ticker} className={`border transition-colors ${zoneStyles[a.zone]}`}>
                <CardContent className="pt-4 pb-5">
                  {/* Header row */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/research/${encodeURIComponent(a.ticker)}`} className="font-semibold hover:text-zinc-300 transition-colors">
                          {a.ticker}
                        </Link>
                        {a.companyName && <span className="text-zinc-400 text-sm">{a.companyName}</span>}
                        <Badge className={`text-xs ${zoneBadge[a.zone]}`}>
                          {a.zone === "buy" ? "Buy Zone" : a.zone === "sell" ? "Sell Zone" : a.zone === "hold" ? "Hold" : "—"}
                        </Badge>
                        {a.verdict && (
                          <Badge className={`text-xs capitalize ${verdictBadge[a.verdict] ?? "bg-zinc-700 text-zinc-300"}`}>
                            {a.verdict}
                          </Badge>
                        )}
                      </div>
                      <p className="text-zinc-500 text-xs mt-0.5">Report: {a.reportDate}</p>
                    </div>

                    <div className="text-right shrink-0 ml-4">
                      {a.currentPrice != null ? (
                        <>
                          <p className="text-lg font-bold">{fmt(a.currentPrice, a.currency)}</p>
                          {!a.isCommodity && a.changePercent != null && (
                            <p className={`text-xs ${a.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                              {a.changePercent >= 0 ? "+" : ""}{a.changePercent.toFixed(2)}% today
                            </p>
                          )}
                          {a.isCommodity && <p className="text-xs text-zinc-500">at report date</p>}
                        </>
                      ) : (
                        <p className="text-zinc-500 text-sm">—</p>
                      )}
                      <div className="flex gap-3 mt-1 text-xs text-zinc-500">
                        <span>Buy &lt; {fmt(a.buyBelow, a.currency)}</span>
                        <span>Sell &gt; {fmt(a.sellAbove, a.currency)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Price range chart */}
                  {a.priceLenses && a.priceLenses.length > 0 ? (
                    <PriceRangeChart
                      lenses={a.priceLenses}
                      consensusBuyBelow={a.consensusBuyBelow}
                      consensusSellAbove={a.consensusSellAbove}
                      intrinsicValueLow={a.intrinsicValueLow}
                      intrinsicValueHigh={a.intrinsicValueHigh}
                      currentPrice={a.currentPrice ?? undefined}
                      currency={a.currency}
                    />
                  ) : (
                    <div>
                      <p className="text-xs text-zinc-500 mb-1.5">AI Consensus</p>
                      <PriceRangeChart
                        lenses={[]}
                        consensusBuyBelow={a.consensusBuyBelow}
                        consensusSellAbove={a.consensusSellAbove}
                        intrinsicValueLow={a.intrinsicValueLow}
                        intrinsicValueHigh={a.intrinsicValueHigh}
                        currentPrice={a.currentPrice ?? undefined}
                        currency={a.currency}
                        mini
                      />
                    </div>
                  )}

                  {/* Card actions */}
                  <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-zinc-800/70">
                    <Link
                      href={`/research/${encodeURIComponent(a.ticker)}`}
                      className={`${buttonVariants({ variant: "outline", size: "sm" })} border-zinc-700 text-zinc-300 h-8 text-xs`}
                    >
                      Open Report
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveFromWatchList(a.watchlistId)}
                      title="Remove from watch list and clear its alerts (keeps the research report)"
                      className="text-zinc-500 hover:text-red-400 h-8 text-xs"
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="border-t border-zinc-800" />

      {/* ── Manual Stock Picks ── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Manual Picks</h2>
          <Button onClick={() => setShowAdd(!showAdd)} variant="outline" size="sm" className="border-zinc-700 text-zinc-300 h-8 text-xs">
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
                  { key: "targetPrice", label: "IV / Target (AUD)", type: "number" },
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

        {picksLoading ? (
          <p className="text-zinc-500 text-sm">Loading…</p>
        ) : picks.length === 0 ? (
          <p className="text-zinc-500 text-sm">No manual picks yet.</p>
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
                        <Badge className={`text-xs capitalize ${pickStatusStyles[p.status] ?? "bg-zinc-700 text-zinc-300"}`}>{p.status}</Badge>
                        {p.moatType && <Badge className="bg-zinc-800 text-zinc-400 text-xs">{p.moatType}</Badge>}
                      </div>
                      {p.thesis && <p className="text-zinc-400 text-sm max-w-xl">{p.thesis}</p>}
                    </div>
                    <div className="flex items-center gap-5 text-sm shrink-0 ml-4">
                      {p.entryPrice && <div className="text-right"><p className="text-xs text-zinc-400">Entry</p><p className="font-medium">AU${p.entryPrice.toFixed(2)}</p></div>}
                      {q && <div className="text-right"><p className="text-xs text-zinc-400">Now</p><p className="font-medium">AU${q.lastPrice.toFixed(2)}</p></div>}
                      {p.targetPrice && <div className="text-right"><p className="text-xs text-zinc-400">IV</p><p className="font-medium">AU${p.targetPrice.toFixed(2)}</p></div>}
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
      </section>
    </div>
  );
}
