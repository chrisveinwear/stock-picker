"use client";
import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { marginOfSafetyPct } from "@/lib/mos";

type ResearchAlert = {
  watchlistId: number;
  ticker: string;
  companyName: string | null;
  buyBelow: number;
  sellAbove: number;
  intrinsicValueLow: number | null;
  intrinsicValueHigh: number | null;
  currentPrice: number | null;
  changePercent: number | null;
  zone: "buy" | "hold" | "sell" | "unknown";
  isCommodity: boolean;
  currency: string;
};

const LAST_CHECK_KEY = "alertLastCheckedAt";

export default function ActionAlertsPage() {
  const [all, setAll] = useState<ResearchAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/research/alerts");
    const data = await res.json();
    setAll(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      // Refresh live prices/zones and run the backend check (keeps the daily alert log current).
      await Promise.all([load(), fetch("/api/alerts/check", { method: "POST" })]);
      const now = new Date().toISOString();
      localStorage.setItem(LAST_CHECK_KEY, now);
      setLastChecked(now);
    } finally {
      setChecking(false);
    }
  }, [load]);

  useEffect(() => {
    const init = async () => {
      await load();
      setLastChecked(localStorage.getItem(LAST_CHECK_KEY));
    };
    void init();
  }, [load]);

  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" }) : "—";

  const fmt = (v: number, currency = "AU$") =>
    `${currency}${v >= 1000 ? (v / 1000).toFixed(1) + "k" : v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;

  // Only watch list items whose live price is currently in the buy or sell zone.
  const alerts = all.filter((a) => a.zone === "buy" || a.zone === "sell");

  return (
    <div className="space-y-8 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Action Alerts</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Watch list stocks whose live price is in the buy or sell zone
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastChecked && (
            <span className="text-xs text-zinc-500">Last checked {fmtDate(lastChecked)}</span>
          )}
          <Button
            onClick={runCheck}
            disabled={checking}
            variant="outline"
            className="border-zinc-700 text-zinc-300"
          >
            {checking ? "Checking…" : "Check Now"}
          </Button>
        </div>
      </div>

      {/* Alerts — live, in-zone only */}
      {loading ? (
        <p className="text-zinc-500 text-sm">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="text-zinc-500 text-sm">
          No active alerts — all watch list stocks are within thresholds.
        </p>
      ) : (
        <div className="space-y-2">
          {alerts.map((a) => {
            const isBuy = a.zone === "buy";
            const price = a.currentPrice ?? 0;
            const target = isBuy ? a.buyBelow : a.sellAbove;
            const mos =
              isBuy && !a.isCommodity
                ? marginOfSafetyPct(a.intrinsicValueLow, a.intrinsicValueHigh, price)
                : null;
            return (
              <div
                key={`${a.ticker}-${a.zone}`}
                className={`flex items-center justify-between p-4 rounded-lg border ${
                  isBuy ? "border-emerald-700 bg-emerald-950/30" : "border-red-900 bg-red-950/20"
                }`}
              >
                <div className="flex items-center gap-4">
                  <Badge className={isBuy ? "bg-emerald-900 text-emerald-300" : "bg-red-900 text-red-300"}>
                    {isBuy ? "Buy Zone" : "Sell Zone"}
                  </Badge>
                  <div>
                    <p className="font-semibold">{a.ticker}</p>
                    {a.companyName && <p className="text-xs text-zinc-400">{a.companyName}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-6 text-sm">
                  <div className="text-right">
                    <p className="text-xs text-zinc-400">Price</p>
                    <p className="font-medium">{fmt(price, a.currency)}</p>
                    {!a.isCommodity && a.changePercent != null && (
                      <p className={`text-xs ${a.changePercent >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {a.changePercent >= 0 ? "+" : ""}{a.changePercent.toFixed(2)}%
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-zinc-400">{isBuy ? "Buy Below" : "Sell Above"}</p>
                    <p className="font-medium">{fmt(target, a.currency)}</p>
                  </div>
                  {mos != null && (
                    <div className="text-right">
                      <p className="text-xs text-zinc-400">MOS</p>
                      <p className={`font-medium ${mos >= 30 ? "text-emerald-400" : "text-amber-400"}`}>
                        {mos.toFixed(1)}%
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
