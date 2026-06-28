import { Card, CardContent } from "@/components/ui/card";
import type { ValuationSidecar } from "@/lib/valuation/store";

function num(v: number | null | undefined): string {
  if (v == null) return "n/a";
  return v.toLocaleString("en-AU", { maximumFractionDigits: v >= 100 ? 0 : 2 });
}

/**
 * Transparency panel: the deterministic code valuation beside the report's
 * (LLM, reconciled) IV, with assumptions, method/cost-curve detail and any model
 * warnings. Renders an equity (DCF) or commodity (incentive-price) variant.
 */
export default function ValuationCard({ sidecar }: { sidecar: ValuationSidecar }) {
  const m = sidecar.model;
  const llmFair = sidecar.llm?.fairValue ?? null;
  const div = sidecar.divergencePct;
  const divColor = div == null ? "text-zinc-400" : Math.abs(div) <= 20 ? "text-emerald-400" : "text-amber-400";

  // Unit/currency-aware formatter.
  const isCommodity = m.kind === "commodity";
  const cur = isCommodity ? "" : m.currency === "AUD" ? "A$" : m.currency === "USD" ? "US$" : m.currency;
  const unit = isCommodity ? ` ${m.currency}` : "";
  const fmt = (v: number | null | undefined) => (v == null ? "n/a" : `${cur ? cur + " " : ""}${num(v)}${unit}`);

  const tile = (label: string, big: string, sub?: string, color?: string) => (
    <div className="bg-zinc-950/40 rounded-lg p-3 border border-zinc-800">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${color ?? ""}`}>{big}</p>
      {sub && <p className="text-xs text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  );

  const reportRange = sidecar.llm?.intrinsicValueLow != null
    ? `range ${fmt(sidecar.llm.intrinsicValueLow)}–${fmt(sidecar.llm.intrinsicValueHigh)}`
    : undefined;

  return (
    <Card className="bg-zinc-900 border-zinc-800">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Valuation &amp; Reconciliation</p>
          <span className="text-[10px] font-mono text-zinc-500 border border-zinc-700 rounded px-1.5 py-0.5">
            model {m.modelVersion}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tile(isCommodity ? "Incentive price (fair)" : "Code model FV", fmt(m.codeFairValue), `range ${fmt(m.codeIvLow)}–${fmt(m.codeIvHigh)}`)}
          {tile("Report (reconciled)", fmt(llmFair), reportRange)}
          {isCommodity
            ? tile("Spot vs incentive", m.spotVsIncentivePct == null ? "n/a" : `${m.spotVsIncentivePct > 0 ? "+" : ""}${m.spotVsIncentivePct.toFixed(0)}%`, `zone: ${m.verdictZone}`)
            : tile("Analyst target", fmt(m.analystTargetMean))}
          <div className="bg-zinc-950/40 rounded-lg p-3 border border-zinc-800">
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Report vs code</p>
            <p className={`text-lg font-bold mt-0.5 ${divColor}`}>{div == null ? "n/a" : `${div > 0 ? "+" : ""}${div.toFixed(1)}%`}</p>
            <p className="text-xs text-zinc-500 mt-0.5">{isCommodity ? "spot" : "price"} {fmt(m.price)}</p>
          </div>
        </div>

        <div className="mt-4 text-xs text-zinc-400 space-y-1 font-mono">
          {isCommodity ? (
            <>
              <p>
                <span className="text-zinc-500">Cost curve:</span> AISC 50th {fmt(m.costCurve.aisc50)} · AISC 90th {fmt(m.costCurve.aisc90)} · incentive {fmt(m.costCurve.incentivePrice)}
              </p>
              <p>
                <span className="text-zinc-500">Zones:</span> buy &lt; {fmt(m.buyBelow)} · avoid &gt; {fmt(m.sellAbove)} · thesis {m.costCurve.thesis}
              </p>
            </>
          ) : (
            <>
              <p>
                <span className="text-zinc-500">Methods:</span> DCF {fmt(m.methods.dcf)} · OE×{m.ownerEarningsMultiple} {fmt(m.methods.ownerEarningsMultiple)} · Graham {fmt(m.methods.graham)} · implied growth {m.methods.impliedGrowth == null ? "n/a" : (m.methods.impliedGrowth * 100).toFixed(1) + "%"}
              </p>
              <p>
                <span className="text-zinc-500">Drivers:</span> WACC {(m.wacc * 100).toFixed(1)}% · quality {m.qualityTier} · {m.baseBasis}
              </p>
            </>
          )}
        </div>

        <details className="mt-3">
          <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">Assumptions &amp; sources</summary>
          <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[11px] font-mono text-zinc-400">
            {Object.entries(m.assumptions).map(([k, t]) => (
              <div key={k}>
                <span className="text-zinc-500">{k}</span> {t.value} <span className="text-zinc-600">[{t.source}]</span>
              </div>
            ))}
          </div>
        </details>

        {m.warnings.length > 0 && (
          <div className="mt-3 rounded-md border border-amber-800/60 bg-amber-950/30 p-2">
            <p className="text-[10px] uppercase tracking-wide text-amber-400 mb-1">Model warnings</p>
            <ul className="text-[11px] text-amber-300/90 list-disc list-inside space-y-0.5">
              {m.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
