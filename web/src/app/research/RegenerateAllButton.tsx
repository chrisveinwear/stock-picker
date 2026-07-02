"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { MODEL_OPTIONS, providerRunningLabel, type ReportProvider } from "./model-options";

type ReportType = "stock" | "metal" | "commodity";
export type RegenTarget = { ticker: string; type: ReportType; name: string | null };

type TickerStatus = "pending" | "running" | "done" | "error";

/**
 * One-click sequential regeneration of every report on the page. Defaults to
 * the free Nemotron model so a full sweep costs nothing and never touches
 * Claude credits. Runs client-side one ticker at a time (each report takes
 * 1–3 minutes; keep the tab open). Errors don't stop the run — failed tickers
 * are reported at the end.
 */
export default function RegenerateAllButton({ targets }: { targets: RegenTarget[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState<ReportProvider>("nemotron");
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, TickerStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tail, setTail] = useState("");
  const cancelRef = useRef(false);

  const doneCount = Object.values(statuses).filter((s) => s === "done").length;
  const errorCount = Object.values(statuses).filter((s) => s === "error").length;

  function reset() {
    setRunning(false);
    setFinished(false);
    setStatuses({});
    setErrors({});
    setTail("");
    cancelRef.current = false;
  }

  async function runOne(t: RegenTarget): Promise<{ ok: boolean; error?: string }> {
    const res = await fetch("/api/research/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: t.ticker, type: t.type, name: t.name ?? undefined, provider }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, error: data.error ?? `HTTP ${res.status}` };
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
      if (doneIdx !== -1) return { ok: true };
      if (errIdx !== -1) return { ok: false, error: buffer.slice(errIdx + 10).trim() };

      // Show just the last few lines so the modal stays readable
      setTail(buffer.slice(-400));
    }
    // Stream ended without a terminal marker — treat as failure
    return { ok: false, error: "stream ended without completion marker" };
  }

  async function handleStart() {
    reset();
    setRunning(true);
    setStatuses(Object.fromEntries(targets.map((t) => [t.ticker, "pending" as TickerStatus])));

    for (const t of targets) {
      if (cancelRef.current) break;
      setStatuses((s) => ({ ...s, [t.ticker]: "running" }));
      setTail("");
      try {
        const result = await runOne(t);
        setStatuses((s) => ({ ...s, [t.ticker]: result.ok ? "done" : "error" }));
        if (!result.ok) setErrors((e) => ({ ...e, [t.ticker]: result.error ?? "unknown error" }));
      } catch (err) {
        setStatuses((s) => ({ ...s, [t.ticker]: "error" }));
        setErrors((e) => ({ ...e, [t.ticker]: err instanceof Error ? err.message : String(err) }));
      }
    }

    setRunning(false);
    setFinished(true);
    router.refresh();
  }

  const statusIcon: Record<TickerStatus, string> = {
    pending: "·",
    running: "…",
    done: "✓",
    error: "✕",
  };
  const statusColor: Record<TickerStatus, string> = {
    pending: "text-zinc-600",
    running: "text-amber-400",
    done: "text-emerald-400",
    error: "text-red-400",
  };

  return (
    <>
      <Button
        onClick={() => { reset(); setOpen(true); }}
        className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm"
        title="Regenerate every report in sequence"
      >
        ↻ Regenerate All
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => { if (!running) setOpen(false); }}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold">
                {running
                  ? `Regenerating ${doneCount + errorCount + 1} of ${targets.length}…`
                  : finished
                  ? `Done — ${doneCount} regenerated${errorCount ? `, ${errorCount} failed` : ""}`
                  : `Regenerate all ${targets.length} reports`}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {running || finished
                  ? `${providerRunningLabel(provider)} · sequential`
                  : "Each report takes 1–3 minutes; the run continues while this tab stays open."}
              </p>
            </div>

            {!running && !finished && (
              <div className="px-6 py-4 space-y-4">
                <div className="space-y-1.5">
                  <p className="text-xs text-zinc-400">AI model for the batch</p>
                  <div className="flex gap-2">
                    {MODEL_OPTIONS.map((m) => (
                      <button
                        key={m.value}
                        onClick={() => setProvider(m.value)}
                        title={m.detail}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                          provider === m.value
                            ? "bg-zinc-600 text-zinc-100"
                            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-zinc-600">
                    {MODEL_OPTIONS.find((m) => m.value === provider)?.detail}
                    {provider === "nemotron" && " — $0 for the whole batch"}
                  </p>
                </div>
              </div>
            )}

            {(running || finished) && (
              <div className="flex-1 overflow-y-auto px-6 py-3">
                <ul className="space-y-1">
                  {targets.map((t) => {
                    const s = statuses[t.ticker] ?? "pending";
                    return (
                      <li key={t.ticker} className="flex items-baseline gap-2 text-sm">
                        <span className={`w-4 text-center ${statusColor[s]}`}>{statusIcon[s]}</span>
                        <span className="text-zinc-300">{t.ticker}</span>
                        {t.name && <span className="text-zinc-600 text-xs truncate">{t.name}</span>}
                        {s === "error" && (
                          <span className="text-red-400/80 text-xs truncate" title={errors[t.ticker]}>
                            {errors[t.ticker]}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {running && tail && (
                  <pre className="mt-3 p-3 bg-zinc-950 rounded-lg text-[10px] text-zinc-500 whitespace-pre-wrap max-h-32 overflow-hidden">
                    {tail}
                  </pre>
                )}
              </div>
            )}

            <div className="px-6 py-4 border-t border-zinc-800 flex justify-between items-center">
              {running ? (
                <button
                  onClick={() => { cancelRef.current = true; }}
                  className="text-xs text-red-400/80 hover:text-red-300 transition-colors"
                >
                  {cancelRef.current ? "Stopping after current report…" : "Stop after current report"}
                </button>
              ) : (
                <button
                  onClick={() => setOpen(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Close
                </button>
              )}
              {!running && !finished && (
                <Button
                  onClick={handleStart}
                  disabled={targets.length === 0}
                  className="bg-emerald-700 hover:bg-emerald-600 text-white text-sm disabled:opacity-40"
                >
                  Start batch →
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
