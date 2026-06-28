"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";

type Announcement = {
  id: number;
  ticker: string;
  companyName: string | null;
  title: string;
  url: string | null;
  publishedAt: string | null;
  impact: string | null;
  sentiment: string | null;
  thesisFlag: boolean;
  thesisNote: string | null;
  aiSummary: string | null;
};

const sentimentDot: Record<string, string> = {
  positive: "bg-emerald-500",
  negative: "bg-red-500",
  neutral: "bg-zinc-500",
};

function fmtDate(s: string | null): string {
  if (!s) return "";
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
}

export default function AnnouncementAlerts() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts/announcements", { cache: "no-store" });
      const data = await res.json();
      setItems(data.announcements ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function dismiss(id: number) {
    setItems((prev) => prev.filter((i) => i.id !== id)); // optimistic
    await fetch("/api/alerts/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  // Hide the section entirely when there's nothing material to show.
  if (loading || items.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-semibold text-zinc-100">📰 Material Announcements</h2>
        <span className="text-xs text-zinc-500">{items.length} price-sensitive item{items.length !== 1 ? "s" : ""}</span>
      </div>

      <div className="space-y-2">
        {items.map((a) => (
          <Card key={a.id} className="bg-zinc-900 border-zinc-800">
            <CardContent className="py-3">
              <div className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${sentimentDot[a.sentiment ?? "neutral"]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{a.ticker.replace(".AX", "")}</span>
                    <span className="text-[11px] text-zinc-500 truncate">{a.companyName}</span>
                    {a.impact === "high" && (
                      <span className="text-[10px] border border-amber-500/40 text-amber-300 bg-amber-500/10 rounded px-1.5 py-0.5 uppercase">
                        high impact
                      </span>
                    )}
                    {a.thesisFlag && (
                      <span className="text-[10px] border border-red-500/40 text-red-300 bg-red-500/10 rounded px-1.5 py-0.5">
                        thesis
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-600">{fmtDate(a.publishedAt)}</span>
                  </div>
                  <p className="text-sm mt-1">
                    {a.url ? (
                      <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-zinc-200 hover:text-emerald-400 hover:underline">
                        {a.title}
                      </a>
                    ) : (
                      <span className="text-zinc-200">{a.title}</span>
                    )}
                  </p>
                  {a.aiSummary && <p className="text-xs text-zinc-500 mt-0.5">{a.aiSummary}</p>}
                  {a.thesisFlag && a.thesisNote && <p className="text-xs text-red-300/80 mt-0.5">⚠ {a.thesisNote}</p>}
                </div>
                <button
                  onClick={() => dismiss(a.id)}
                  className="shrink-0 text-[11px] border border-zinc-700 rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800"
                >
                  Dismiss
                </button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
