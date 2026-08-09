"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ParsedRow = {
  ticker: string;
  holdingName: string;
  economicMoat: string | null;
  priceToFairValue: number | null;
};

type ImportResult = {
  saved: number;
  asOfDate: string;
  detectedColumns: Record<string, number>;
  rows: ParsedRow[];
  skipped: { raw: string; reason: string }[];
  priceWarnings?: string[];
};

export default function MorningstarImportButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // .xlsx (e.g. the filled-in download template) is sent as raw bytes and
      // converted server-side; anything else is read as CSV text.
      const isXlsx = /\.xlsx$/i.test(file.name);
      const res = isXlsx
        ? await fetch("/api/morningstar", {
            method: "POST",
            headers: {
              "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "X-Filename": file.name,
            },
            body: await file.arrayBuffer(),
          })
        : await fetch("/api/morningstar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csv: await file.text(), filename: file.name }),
          });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setResult(data as ImportResult);
      router.refresh();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setResult(null);
    setError(null);
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = ""; // allow re-uploading the same filename
        }}
      />
      <Button
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm disabled:opacity-50"
        title="Upload a Morningstar export or the filled-in template — CSV or Excel (economic moat + fair value)"
      >
        {busy ? "Importing…" : "↑ Import Morningstar"}
      </Button>

      {(result || error) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={close}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <div>
                <h2 className="font-semibold text-zinc-100">
                  {error ? "Import failed" : "✓ Morningstar data imported"}
                </h2>
                {result && (
                  <p className="text-xs text-zinc-500 mt-0.5">
                    {result.saved} holdings · as of {result.asOfDate} ·{" "}
                    {result.skipped.length} skipped
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={close}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Close
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {error && <p className="text-sm text-red-400">{error}</p>}

              {result && (
                <>
                  <table className="w-full text-xs">
                    <thead className="text-zinc-500 border-b border-zinc-800">
                      <tr className="text-left">
                        <th className="py-1.5 pr-2">Ticker</th>
                        <th className="py-1.5 pr-2">Moat</th>
                        <th className="py-1.5 pr-2 text-right">P/FV</th>
                        <th className="py-1.5 text-right">Discount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r) => {
                        const pct =
                          r.priceToFairValue != null
                            ? (1 - r.priceToFairValue) * 100
                            : null;
                        return (
                          <tr key={r.ticker} className="border-b border-zinc-800/50">
                            <td className="py-1.5 pr-2 font-mono text-zinc-200">{r.ticker}</td>
                            <td className="py-1.5 pr-2 text-zinc-400">{r.economicMoat ?? "—"}</td>
                            <td className="py-1.5 pr-2 text-right text-zinc-300">
                              {r.priceToFairValue?.toFixed(2) ?? "—"}
                            </td>
                            <td
                              className={`py-1.5 text-right ${
                                pct == null
                                  ? "text-zinc-500"
                                  : pct >= 30
                                  ? "text-emerald-400"
                                  : pct >= 0
                                  ? "text-zinc-300"
                                  : "text-red-400"
                              }`}
                            >
                              {pct == null
                                ? "—"
                                : `${pct >= 0 ? "" : "+"}${Math.abs(pct).toFixed(0)}%${
                                    pct >= 0 ? " disc" : " prem"
                                  }`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  {result.priceWarnings && result.priceWarnings.length > 0 && (
                    <p className="text-xs text-amber-400 bg-amber-950/30 rounded-lg p-3">
                      ⚠ Couldn&apos;t fetch a live price for {result.priceWarnings.join(", ")} — Fair
                      Value was saved but Price/Fair Value couldn&apos;t be computed. Double-check the
                      ticker code (ASX codes don&apos;t always match the company&apos;s brand name,
                      e.g. nib holdings trades as NHF, not NIB).
                    </p>
                  )}

                  {result.skipped.length > 0 && (
                    <details className="text-xs text-zinc-500">
                      <summary className="cursor-pointer hover:text-zinc-300">
                        {result.skipped.length} rows skipped (not covered / not a stock)
                      </summary>
                      <ul className="mt-2 space-y-1 pl-2">
                        {result.skipped.map((s, i) => (
                          <li key={i}>• {s.reason}</li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <p className="text-xs text-zinc-600 bg-zinc-800/60 rounded-lg p-3">
                    These values now feed the <strong>Morningstar</strong> lens in every
                    new research report for these tickers as an independent cross-check.
                    Re-upload any time to refresh — each upload is stored as a dated snapshot.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
