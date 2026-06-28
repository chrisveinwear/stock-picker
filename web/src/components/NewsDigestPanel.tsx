"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type DigestItem = {
  id: number;
  title: string;
  url: string | null;
  publishedAt: string | null;
  sentiment: string | null;
  impact: string | null;
  thesisFlag: boolean;
  thesisNote: string | null;
  aiSummary: string | null;
  seen: boolean;
};

type DigestGroup = {
  ticker: string;
  companyName: string | null;
  items: DigestItem[];
  highImpactCount: number;
  unseenCount: number;
  worstSentiment: "positive" | "neutral" | "negative";
  thesisFlagged: boolean;
};

type DigestResponse = { groups: DigestGroup[]; classifierAvailable: boolean };

const sentimentDot: Record<string, string> = {
  positive: "bg-emerald-500",
  negative: "bg-red-500",
  neutral: "bg-zinc-500",
};

function impactBadge(impact: string | null) {
  if (impact === "high") return "border-amber-500/40 text-amber-300 bg-amber-500/10";
  if (impact === "medium") return "border-zinc-600 text-zinc-300 bg-zinc-800/40";
  return "border-zinc-700 text-zinc-500 bg-transparent";
}

function fmtDate(s: string | null): string {
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s; // relative string like "1 week ago"
}

export default function NewsDigestPanel() {
  const [data, setData] = useState<DigestResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/news/digest", { cache: "no-store" });
      setData(await res.json());
    } finally {
      setLoading(false);
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/news/digest", { method: "POST" });
      setData(await res.json());
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const groups = data?.groups ?? [];

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">
              What moved my holdings
            </p>
            <p className="text-[11px] text-zinc-600 mt-0.5">
              Recent news per holding, ranked by impact
            </p>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="text-[11px] border border-zinc-700 rounded px-2.5 py-1 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {data && !data.classifierAvailable && (
          <p className="text-[11px] text-amber-400/80 mb-3">
            Claude CLI unavailable — showing headlines without AI classification.
          </p>
        )}

        {loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No recent news cached. Hit Refresh to pull the latest for your holdings.
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.ticker} className="border-b border-zinc-800/60 pb-3 last:border-0 last:pb-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className={`h-2 w-2 rounded-full ${sentimentDot[g.worstSentiment]}`} />
                  <span className="font-semibold text-sm">{g.ticker.replace(".AX", "")}</span>
                  <span className="text-[11px] text-zinc-500 truncate">{g.companyName}</span>
                  {g.thesisFlagged && (
                    <span className="text-[10px] border border-red-500/40 text-red-300 bg-red-500/10 rounded px-1.5 py-0.5">
                      thesis
                    </span>
                  )}
                  {g.highImpactCount > 0 && (
                    <span className="text-[10px] text-amber-300">{g.highImpactCount} high-impact</span>
                  )}
                </div>
                <ul className="space-y-1.5 pl-4">
                  {g.items.map((it) => (
                    <li key={it.id} className="text-xs">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 shrink-0 rounded border px-1 text-[9px] uppercase ${impactBadge(it.impact)}`}>
                          {it.impact ?? "—"}
                        </span>
                        <div className="min-w-0">
                          {it.url ? (
                            <a
                              href={it.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-zinc-200 hover:text-emerald-400 hover:underline"
                            >
                              {it.title}
                            </a>
                          ) : (
                            <span className="text-zinc-200">{it.title}</span>
                          )}
                          <span className="text-zinc-600"> · {fmtDate(it.publishedAt)}</span>
                          {it.aiSummary && <p className="text-zinc-500 mt-0.5">{it.aiSummary}</p>}
                          {it.thesisFlag && it.thesisNote && (
                            <p className="text-red-300/80 mt-0.5">⚠ {it.thesisNote}</p>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
