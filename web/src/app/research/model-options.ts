/** Model/provider choices shared by the report-generation UI. Mirrors
 *  ReportProvider in lib/ai/report-providers (kept apart — this is imported by
 *  client components, that module pulls in node builtins). */
export type ReportProvider = "auto" | "claude" | "nemotron";

export const MODEL_OPTIONS: { value: ReportProvider; label: string; detail: string }[] = [
  { value: "auto", label: "Auto", detail: "Claude, falls back to Nemotron if unavailable" },
  { value: "claude", label: "Claude Opus", detail: "claude-opus-4-8 via Claude Code CLI" },
  { value: "nemotron", label: "Nemotron (free)", detail: "Nemotron 3 Ultra via OpenRouter" },
];

export function providerRunningLabel(provider: ReportProvider): string {
  return provider === "claude"
    ? "claude-opus-4-8"
    : provider === "nemotron"
    ? "nemotron-3-ultra (free)"
    : "auto (claude → nemotron)";
}
