/**
 * Deterministic post-generation integrity validator.
 *
 * Runs in code (no LLM) against the generated report, enforcing the prompt's
 * data-integrity rules mechanically. Two severities:
 *  - "error"   → fabrication the generator was explicitly told not to produce
 *                (invented consensus tables, estimated indicator readings,
 *                short-interest figures, anchor numbers contradicting the
 *                computed technicals). Errors trigger one regeneration with
 *                feedback; if they persist the report saves with visible flags.
 *  - "warning" → a required "data not available" declaration is missing but
 *                nothing was fabricated. Recorded, never blocks.
 *
 * The bake-off fixtures that motivated each rule: Claude's CKF/BXB reports
 * fabricated EPS-vs-consensus tables, A2M/CKF invented short-interest
 * percentages, and A2M/BXB "estimated" RSI/moving averages despite a computed
 * technicals block being supplied.
 */
import matter from "gray-matter";
import type { TechnicalReading } from "@/lib/technicals";

export type IntegrityViolation = {
  severity: "error" | "warning";
  rule: string;
  detail: string;
};

export type ValidationContext = {
  type: "stock" | "metal" | "commodity";
  /** Computed technicals injected into the prompt; null when none were supplied. */
  technicals?: TechnicalReading | null;
  /** Authoritative live price injected into the prompt (priceCurrency units). */
  price?: number | null;
};

/** Slice the report body between numbered section headings (e.g. 12 → 13).
 *  Headings appear as "### 12. JPMorgan…", "## 12)", "**12." etc. */
function section(content: string, n: number): string {
  const start = content.search(new RegExp(`^#{2,4}\\s*\\**\\s*${n}[.)]`, "m"));
  if (start === -1) return "";
  const rest = content.slice(start);
  const next = rest
    .slice(3)
    .search(new RegExp(`^#{2,4}\\s*\\**\\s*${n + 1}[.)]|^## `, "m"));
  return next === -1 ? rest : rest.slice(0, next + 3);
}

const NOT_AVAILABLE = /not\s+(?:available|provided|supplied|reported|disclosed)|unavailable/i;

/** Numbers a model might cite for an indicator, e.g. "RSI(14): 73.5" or
 *  "50-day SMA: AUD 6.31". Grabs currency-ish numbers within the same line. */
function numbersNear(text: string, term: RegExp): number[] {
  const out: number[] = [];
  for (const line of text.split("\n")) {
    if (!term.test(line)) continue;
    for (const m of line.matchAll(/-?\d+(?:,\d{3})*(?:\.\d+)?/g)) {
      const v = Number(m[0].replace(/,/g, ""));
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

const closeTo = (values: number[], target: number, tolPct: number, tolAbs = 0.6) =>
  values.some((v) => Math.abs(v - target) <= Math.max(Math.abs(target) * tolPct, tolAbs));

export function validateReportIntegrity(
  content: string,
  ctx: ValidationContext
): IntegrityViolation[] {
  const violations: IntegrityViolation[] = [];

  // ── Frontmatter must parse and priceLenses must match the consumer schema ─
  // (report page / picks page / alerts all read `name` + numeric bounds; the
  // NEM 2026-07-02 Claude run drifted to `lens:` keys, breaking the widgets).
  try {
    const { data } = matter(content);
    if (Array.isArray(data.priceLenses)) {
      const bad = (data.priceLenses as unknown[]).filter(
        (l) =>
          !l ||
          typeof l !== "object" ||
          typeof (l as Record<string, unknown>).name !== "string" ||
          typeof (l as Record<string, unknown>).buyBelow !== "number" ||
          typeof (l as Record<string, unknown>).sellAbove !== "number"
      );
      if (bad.length) {
        violations.push({
          severity: "error",
          rule: "malformed-price-lenses",
          detail: `${bad.length} priceLenses entr${bad.length === 1 ? "y" : "ies"} missing the required keys — each entry must be exactly { name: "<string>", buyBelow: <number>, fairValue: <number>, sellAbove: <number> } (the key is "name", not "lens").`,
        });
      }
    }
  } catch (e) {
    violations.push({
      severity: "error",
      rule: "unparseable-frontmatter",
      detail: `YAML frontmatter failed to parse: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`,
    });
  }

  if (ctx.type !== "stock") return violations; // remaining rules are equity-specific; commodity numbers are code-stamped

  // ── §12: no invented EPS-vs-consensus tables ─────────────────────────────
  const earnings = section(content, 12);
  if (earnings) {
    const tableRows = earnings.split("\n").filter((l) => /^\s*\|/.test(l));
    const consensusTable = tableRows.some((l) => /consensus/i.test(l));
    if (consensusTable) {
      // Numeric cells in rows below a consensus-labelled header = fabricated
      // estimates (consensus history is never supplied). "n/a"/"—" cells are fine.
      const headerIdx = tableRows.findIndex((l) => /consensus/i.test(l));
      const dataRows = tableRows.slice(headerIdx + 1);
      const fabricated = dataRows.some((l) =>
        l.split("|").some((cell) => /(?:^|[^a-z0-9.])[~≈]?\s*[+-]?\d+(?:\.\d+)?\s*%?\s*$/i.test(cell.trim()) && !/n\/a|—|-$/.test(cell.trim()))
      );
      if (fabricated) {
        violations.push({
          severity: "error",
          rule: "fabricated-consensus-table",
          detail:
            "Section 12 contains a table with a consensus column populated with numbers, but consensus-estimate history is never supplied. State 'consensus history not available' instead.",
        });
      }
    }
  }

  // ── §16: insider / institutional / short-interest must not carry figures ─
  const quant = section(content, 16);
  if (quant) {
    const checks: { term: RegExp; label: string }[] = [
      { term: /insider/i, label: "insider activity" },
      { term: /institutional\s+ownership/i, label: "institutional ownership" },
      { term: /short\s+interest/i, label: "short interest" },
    ];
    for (const { term, label } of checks) {
      const lines = quant.split("\n").filter((l) => term.test(l));
      if (lines.length === 0) continue;
      const block = lines.join("\n");
      const hasFigure = /\d+(?:\.\d+)?\s*[–—-]?\s*\d*(?:\.\d+)?\s*%/.test(block);
      const declared = NOT_AVAILABLE.test(block);
      if (hasFigure && !declared) {
        violations.push({
          severity: "error",
          rule: "fabricated-quant-figure",
          detail: `Section 16 quotes a ${label} percentage, but that data is never supplied. State 'data not available' instead of a figure.`,
        });
      } else if (!declared) {
        violations.push({
          severity: "warning",
          rule: "missing-availability-declaration",
          detail: `Section 16 discusses ${label} without stating the data is not available.`,
        });
      }
    }
  }

  // ── §15: technicals must come from the computed block, never estimated ──
  const technical = section(content, 15);
  if (technical && ctx.technicals) {
    const t = ctx.technicals;

    if (/\b(?:est\.|estimated?|approx\.?|roughly)\b/i.test(technical) &&
        /(rsi|sma|moving average|macd|\d+-day)/i.test(technical)) {
      const offending = technical
        .split("\n")
        .filter((l) => /\b(?:est\.|estimated?|approx\.?|roughly)\b/i.test(l) && /(rsi|sma|moving average|macd|\d+-day)/i.test(l));
      if (offending.length) {
        violations.push({
          severity: "error",
          rule: "estimated-technicals",
          detail: `Section 15 marks indicator readings as estimates despite a computed technicals block being supplied: ${offending[0].trim().slice(0, 120)}`,
        });
      }
    }

    // Anchor checks: if the report cites a value for an indicator we computed,
    // at least one cited number on that line must match ours. Percent-vs-SMA
    // deltas share lines with the SMA value, so match ANY number (tolerant),
    // and only flag when numbers are present yet none agree.
    const anchors: { term: RegExp; value: number | null; label: string; tolPct: number }[] = [
      { term: /rsi/i, value: t.rsi14, label: "RSI(14)", tolPct: 0.02 },
      { term: /50[-\s]?day/i, value: t.sma50, label: "50-day SMA", tolPct: 0.01 },
      { term: /200[-\s]?day/i, value: t.sma200, label: "200-day SMA", tolPct: 0.01 },
    ];
    for (const a of anchors) {
      if (a.value == null) continue;
      const cited = numbersNear(technical, a.term);
      if (cited.length && !closeTo(cited, a.value, a.tolPct)) {
        violations.push({
          severity: "error",
          rule: "technicals-anchor-mismatch",
          detail: `Section 15 cites ${a.label} values [${cited.slice(0, 6).join(", ")}] but the computed reading is ${a.value.toFixed(2)}.`,
        });
      }
    }
  }

  // ── Current price must match the injected authoritative price ───────────
  if (ctx.price != null && ctx.price > 0) {
    const m = content.match(/(?:current price|last close)[^\n]*?(\d+(?:,\d{3})*(?:\.\d+)?)/i);
    if (m) {
      const cited = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(cited) && Math.abs(cited - ctx.price) / ctx.price > 0.02) {
        violations.push({
          severity: "error",
          rule: "price-anchor-mismatch",
          detail: `Report cites current price ${cited} but the authoritative injected price is ${ctx.price}.`,
        });
      }
    }
  }

  return violations;
}

/** Feedback block appended to the prompt for the single regeneration retry. */
export function formatViolationsForRetry(violations: IntegrityViolation[]): string {
  const errors = violations.filter((v) => v.severity === "error");
  return `\n\n## INTEGRITY VIOLATIONS IN YOUR PREVIOUS DRAFT (must be fixed)\n\nYour previous draft of this report violated the data integrity rules. Fix every item below — do not repeat these fabrications:\n${errors
    .map((v, i) => `${i + 1}. [${v.rule}] ${v.detail}`)
    .join("\n")}\n\nRe-generate the complete report with these violations corrected. Where data is not supplied, write "data not available" — never a number.`;
}
