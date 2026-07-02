"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ReportType = "stock" | "metal" | "commodity";

/**
 * Per-card "Regenerate" button. Re-runs the same streaming generation flow as
 * RequestResearchButton, but pre-filled from the existing report (ticker/type/
 * name), so a report can be refreshed in place (e.g. to pick up newly imported
 * Morningstar data or a fresh valuation). Lives inside a card <Link>, so all
 * handlers stop propagation to avoid navigating.
 */
export default function RegenerateReportButton({
  ticker,
  type,
  name,
}: {
  ticker: string;
  type: ReportType;
  name?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function handleRegenerate(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();

    setOpen(true);
    setGenerating(true);
    setStreamText("");
    setError(null);

    try {
      const res = await fetch("/api/research/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, type, name: name?.trim() || undefined }),
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

        buffer += decoder.decode(value, { stream: true });

        const doneIdx = buffer.indexOf("__DONE__:");
        const errIdx = buffer.indexOf("__ERROR__:");

        if (doneIdx !== -1) {
          setStreamText(buffer.slice(0, doneIdx));
          setGenerating(false);
          const meta = buffer.slice(doneIdx + 9);
          try {
            const { path } = JSON.parse(meta);
            setTimeout(() => {
              setOpen(false);
              router.push(path);
              router.refresh();
            }, 1500);
          } catch {
            router.refresh();
          }
          break;
        }

        if (errIdx !== -1) {
          setStreamText(buffer.slice(0, errIdx));
          setError(buffer.slice(errIdx + 10));
          setGenerating(false);
          break;
        }

        setStreamText(buffer);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setGenerating(false);
    }
  }

  const isDone = streamText && !generating && !error;

  return (
    <>
      <button
        onClick={handleRegenerate}
        className="text-xs text-zinc-600 hover:text-emerald-400 transition-colors"
        title="Regenerate this report with the latest data"
      >
        ↻ Regenerate
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!generating) setOpen(false);
          }}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <h2 className="font-semibold text-zinc-100">
                  {isDone ? "✓ Report Regenerated" : "Regenerating Report…"}
                </h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {isDone
                    ? "Saved — redirecting to report page"
                    : `claude-opus-4-8 · ${ticker} · ${type}`}
                </p>
              </div>
              {!generating && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); }}
                  className="text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  Close
                </Button>
              )}
            </div>

            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-5 font-mono text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap"
            >
              {streamText || <span className="text-zinc-600 animate-pulse">Starting generation…</span>}
            </div>

            <div className="px-5 py-3 border-t border-zinc-800 flex items-center gap-3">
              {generating && (
                <div className="flex items-center gap-2 text-xs text-zinc-500">
                  <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Writing report…
                </div>
              )}
              {error && <p className="text-xs text-red-400">Error: {error}</p>}
              {isDone && <p className="text-xs text-emerald-400">✓ Report saved — redirecting…</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
