/**
 * Headless staggered research refresh.
 *
 * Picks the most-stale research targets (watch list + portfolio + metals) and
 * regenerates their reports by driving the same generate route the web app uses
 * — no running Next.js server required. Designed to be run once a day by launchd
 * so the whole list cycles within a month with zero manual action.
 *
 * Run from the web/ directory (so data/ and reports/ resolve):
 *   npx tsx scripts/refresh-due.ts
 *
 * Flags:
 *   --per-day=N      override how many to refresh this run (default ceil(N/28))
 *   --min-age=N      override staleness threshold in days (default 25)
 *   --dry-run        print what would be refreshed, generate nothing
 */
import { selectDueTargets, type RefreshTarget } from "@/lib/refresh-queue";
import { POST } from "@/app/api/research/generate/route";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function log(...parts: unknown[]) {
  console.log(`[refresh-due ${new Date().toISOString()}]`, ...parts);
}

async function generate(target: RefreshTarget): Promise<{ ok: boolean; message: string }> {
  // Equity tickers go to the route as the bare code (it re-appends .AX); metals
  // keep their bare upper-case name. `type` drives the equity vs commodity prompt.
  const ticker =
    target.type === "stock" ? target.ticker.replace(/\.AX$/, "") : target.ticker;

  const req = new Request("http://localhost/api/research/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, type: target.type, name: target.name ?? undefined }),
  });

  const res = await POST(req as never);
  if (!res.body) return { ok: false, message: `no response body (status ${res.status})` };

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }

  const err = buf.match(/__ERROR__:(.*)$/);
  if (err) return { ok: false, message: err[1].trim() };
  const doneMatch = buf.match(/__DONE__:(.*)$/);
  if (doneMatch) return { ok: true, message: doneMatch[1].trim() };
  return { ok: false, message: `no completion marker (${buf.length} chars streamed)` };
}

async function main() {
  const perDay = arg("per-day") ? Number(arg("per-day")) : undefined;
  const minAgeDays = arg("min-age") ? Number(arg("min-age")) : undefined;
  const dryRun = hasFlag("dry-run");

  // --ticker=GOLD forces a one-off regeneration of a specific item, bypassing
  // the staleness rotation (e.g. to fix or refresh a single report on demand).
  const onlyTicker = arg("ticker");
  if (onlyTicker) {
    const type = (arg("type") ?? "stock") as "stock" | "metal" | "commodity";
    const target: RefreshTarget = {
      ticker: onlyTicker.toUpperCase(),
      type,
      name: arg("name") ?? null,
      source: [],
      lastReportDate: null,
      ageDays: null,
    };
    log(`forced refresh of ${target.ticker} (${target.type}) …`);
    const result = await generate(target);
    log(result.ok ? `✓ ${target.ticker}: ${result.message}` : `✗ ${target.ticker}: ${result.message}`);
    return;
  }

  const { targets, total, quota, dueCount } = selectDueTargets({ perDay, minAgeDays });
  log(`tracking ${total} targets · quota ${quota}/day · ${dueCount} due · refreshing ${targets.length}`);

  if (!targets.length) {
    log("nothing due — all reports are fresh.");
    return;
  }

  for (const t of targets) {
    const age = t.ageDays === null ? "never" : `${t.ageDays}d old`;
    if (dryRun) {
      log(`DRY-RUN would refresh ${t.ticker} (${t.type}, ${age}, via ${t.source.join("+")})`);
      continue;
    }
    log(`refreshing ${t.ticker} (${t.type}, last report ${age}) …`);
    try {
      const result = await generate(t);
      log(result.ok ? `✓ ${t.ticker}: ${result.message}` : `✗ ${t.ticker}: ${result.message}`);
      // If we hit the CLI usage limit, stop — the rest will be retried tomorrow.
      if (!result.ok && /usage limit|rate limit|not authenticated/i.test(result.message)) {
        log("stopping early — CLI unavailable; remaining targets will roll to the next run.");
        break;
      }
    } catch (e) {
      log(`✗ ${t.ticker}: threw ${e}`);
    }
  }

  log("done.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error("[refresh-due] fatal", e);
    process.exit(1);
  }
);
