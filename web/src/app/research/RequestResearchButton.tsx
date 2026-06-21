"use client";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ReportType = "stock" | "metal" | "commodity";

export default function RequestResearchButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ticker, setTicker] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<ReportType>("stock");

  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tickerUpper = ticker.trim().toUpperCase();

  function reset() {
    setTicker("");
    setName("");
    setType("stock");
    setGenerating(false);
    setStreamText("");
    setError(null);
  }

  async function handleGenerate() {
    if (!tickerUpper) return;

    setGenerating(true);
    setStreamText("");
    setError(null);

    try {
      const res = await fetch("/api/research/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tickerUpper, type, name: name.trim() || undefined }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Check for terminal signals
        const doneIdx = buffer.indexOf("__DONE__:");
        const errIdx = buffer.indexOf("__ERROR__:");

        if (doneIdx !== -1) {
          // Display text up to the signal
          setStreamText(buffer.slice(0, doneIdx));
          const meta = buffer.slice(doneIdx + 9);
          try {
            const { path } = JSON.parse(meta);
            // Brief pause so user sees completion, then navigate
            setTimeout(() => {
              setOpen(false);
              reset();
              router.push(path);
              router.refresh();
            }, 1500);
          } catch {
            router.refresh();
          }
          break;
        }

        if (errIdx !== -1) {
          const errMsg = buffer.slice(errIdx + 10);
          setStreamText(buffer.slice(0, errIdx));
          setError(errMsg);
          setGenerating(false);
          break;
        }

        setStreamText(buffer);
        // Auto-scroll to bottom
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  }

  if (!open) {
    return (
      <Button
        onClick={() => setOpen(true)}
        className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm"
      >
        + Request Report
      </Button>
    );
  }

  // ── Generating view ──────────────────────────────────────────────────────
  if (generating || streamText || error) {
    const isDone = streamText && !generating && !error;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
            <div>
              <h2 className="font-semibold text-zinc-100">
                {isDone ? "✓ Report Complete" : "Generating Report…"}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {isDone
                  ? "Saved — redirecting to report page"
                  : `claude-opus-4-8 · ${tickerUpper} · ${type}`}
              </p>
            </div>
            {!generating && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setOpen(false); reset(); }}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Close
              </Button>
            )}
          </div>

          {/* Streaming output */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-5 font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap"
          >
            {streamText || <span className="text-zinc-600 animate-pulse">Starting generation…</span>}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-3">
            {generating && (
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Writing report…
              </div>
            )}
            {error && (
              <p className="text-xs text-red-400">Error: {error}</p>
            )}
            {isDone && (
              <p className="text-xs text-emerald-400">✓ Report saved — redirecting…</p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Request form ─────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md space-y-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h2 className="text-lg font-semibold">Generate Research Report</h2>
          <p className="text-zinc-400 text-sm mt-1">
            Claude will research and write a full 17-section analysis using the Buffett framework.
          </p>
        </div>

        {/* Type selector */}
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">Report type</Label>
          <div className="flex gap-2">
            {(["stock", "metal", "commodity"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                  type === t
                    ? "bg-zinc-600 text-zinc-100"
                    : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {t === "stock" ? "📋 ASX Stock" : t === "metal" ? "◆ Metal" : "🛢 Commodity"}
              </button>
            ))}
          </div>
        </div>

        {/* Ticker */}
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            {type === "stock"
              ? "ASX ticker (e.g. CBA, WOW, CSL)"
              : type === "metal"
              ? "Metal (e.g. GOLD, SILVER)"
              : "Commodity (e.g. IRON ORE, LITHIUM)"}
          </Label>
          <Input
            autoFocus
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder={
              type === "stock" ? "CBA" : type === "metal" ? "GOLD" : "IRON ORE"
            }
            className="bg-zinc-800 border-zinc-700 text-zinc-100 uppercase"
          />
        </div>

        {/* Optional company name */}
        <div className="space-y-1.5">
          <Label className="text-xs text-zinc-400">
            Company / asset name{" "}
            <span className="text-zinc-600">(optional)</span>
          </Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
            placeholder={
              type === "stock"
                ? "Commonwealth Bank of Australia"
                : type === "metal"
                ? "Gold (Physical)"
                : "Iron Ore (62% Fe fines)"
            }
            className="bg-zinc-800 border-zinc-700 text-zinc-100"
          />
        </div>

        {/* Info note */}
        <p className="text-xs text-zinc-600 bg-zinc-800/60 rounded-lg p-3">
          ⏱ Generation takes 1–3 minutes. The report streams live so you can watch it being written, then saves automatically.
        </p>

        <div className="flex justify-between items-center pt-1">
          <button
            onClick={() => setOpen(false)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Cancel
          </button>
          <Button
            onClick={handleGenerate}
            disabled={!tickerUpper}
            className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm disabled:opacity-40"
          >
            Generate Report →
          </Button>
        </div>
      </div>
    </div>
  );
}
