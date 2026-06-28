"use client";
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

type Override = { id: number; scope: string; key: string; value: number; note: string | null; updatedAt: string };
type CommodityDef = Record<string, number | string>;
type Data = {
  defaults: Record<string, number>;
  commodityDefaults: Record<string, CommodityDef>;
  overrides: Override[];
};

const COMMODITY_NUMERIC = ["aisc50", "aisc90", "incentivePrice", "overvaluedBand", "mos"];

export default function SettingsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [commodity, setCommodity] = useState("GOLD");

  const load = useCallback(async () => {
    const r = await fetch("/api/valuation/assumptions");
    setData(await r.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  const overrideOf = (scope: string, key: string) =>
    data?.overrides.find((o) => o.scope === scope && o.key === key);

  const save = async (scope: string, key: string, value: number) => {
    setBusy(`${scope}|${key}`);
    await fetch("/api/valuation/assumptions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, key, value, note: "edited in settings" }),
    });
    setDrafts((d) => { const n = { ...d }; delete n[`${scope}|${key}`]; return n; });
    await load();
    setBusy(null);
  };

  const reset = async (scope: string, key: string) => {
    setBusy(`${scope}|${key}`);
    await fetch("/api/valuation/assumptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope, key }),
    });
    setDrafts((d) => { const n = { ...d }; delete n[`${scope}|${key}`]; return n; });
    await load();
    setBusy(null);
  };

  const Row = ({ scope, keyName, def }: { scope: string; keyName: string; def: number }) => {
    const ov = overrideOf(scope, keyName);
    const effective = ov?.value ?? def;
    const dkey = `${scope}|${keyName}`;
    const draft = drafts[dkey] ?? String(effective);
    const parsed = parseFloat(draft);
    const dirty = Number.isFinite(parsed) && parsed !== effective;
    return (
      <tr className="border-b border-zinc-800/60">
        <td className="py-2 pr-3 font-mono text-zinc-300">{keyName}</td>
        <td className="py-2 pr-3 text-zinc-500 font-mono">{def}</td>
        <td className="py-2 pr-3">
          <Input
            value={draft}
            onChange={(e) => setDrafts((d) => ({ ...d, [dkey]: e.target.value }))}
            className="h-8 w-28 bg-zinc-950 border-zinc-700 font-mono text-sm"
            inputMode="decimal"
          />
        </td>
        <td className="py-2 pr-3">
          {ov ? <Badge className="bg-amber-900 text-amber-300 border-amber-700">override</Badge>
              : <span className="text-zinc-600 text-xs">default</span>}
        </td>
        <td className="py-2 flex gap-2">
          <Button size="sm" disabled={!dirty || busy === dkey}
            onClick={() => save(scope, keyName, parsed)}
            className="h-8 text-xs">Save</Button>
          {ov && (
            <Button size="sm" variant="outline" disabled={busy === dkey}
              onClick={() => reset(scope, keyName)}
              className="h-8 text-xs border-zinc-700 text-zinc-400">Reset</Button>
          )}
        </td>
      </tr>
    );
  };

  if (!data) return <div className="text-zinc-500 p-4">Loading assumptions…</div>;

  const commodities = Object.keys(data.commodityDefaults);
  const cdef = data.commodityDefaults[commodity] ?? {};

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Valuation Assumptions</h1>
        <p className="text-zinc-400 mt-1 text-sm">
          File defaults are the audit baseline (versioned in git). Overrides here are stored in the
          database and layered on top by the valuation engine — every report snapshots the exact
          values it used.
        </p>
      </div>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="pt-5">
          <p className="text-xs text-zinc-400 uppercase tracking-wider mb-3 font-medium">Equity model — global defaults</p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                <th className="py-1.5 pr-3 font-medium">Key</th>
                <th className="py-1.5 pr-3 font-medium">File default</th>
                <th className="py-1.5 pr-3 font-medium">Override</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.defaults).map(([k, v]) => (
                <Row key={k} scope="global" keyName={k} def={v} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="bg-zinc-900 border-zinc-800">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-zinc-400 uppercase tracking-wider font-medium">Commodity cost curves</p>
            <select
              value={commodity}
              onChange={(e) => setCommodity(e.target.value)}
              className="h-8 bg-zinc-950 border border-zinc-700 rounded px-2 text-sm text-zinc-200"
            >
              {commodities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <p className="text-[11px] text-zinc-500 mb-3 font-mono">
            unit {String(cdef.unit ?? "?")} · thesis {String(cdef.thesis ?? "?")}
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
                <th className="py-1.5 pr-3 font-medium">Key</th>
                <th className="py-1.5 pr-3 font-medium">File default</th>
                <th className="py-1.5 pr-3 font-medium">Override</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {COMMODITY_NUMERIC.filter((k) => typeof cdef[k] === "number").map((k) => (
                <Row key={`${commodity}-${k}`} scope={commodity} keyName={k} def={cdef[k] as number} />
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
