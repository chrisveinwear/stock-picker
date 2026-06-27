import { NextRequest, NextResponse } from "next/server";
import { selectDueTargets, buildRefreshTargets } from "@/lib/refresh-queue";

export const dynamic = "force-dynamic";

/**
 * GET /api/research/refresh-due
 *   ?all=1        → include the full annotated target list (for a dashboard)
 *   ?perDay=N     → override the daily quota
 *   ?minAgeDays=N → override the minimum age before a report is considered stale
 *
 * Reports which targets are due for a fresh research report. The headless cron
 * script (scripts/refresh-due.ts) uses the same lib directly; this route exists
 * for visibility in the app and for a manual "what's due" check.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const perDay = sp.get("perDay") ? Number(sp.get("perDay")) : undefined;
  const minAgeDays = sp.get("minAgeDays") ? Number(sp.get("minAgeDays")) : undefined;

  try {
    const selection = selectDueTargets({ perDay, minAgeDays });
    const body: Record<string, unknown> = {
      due: selection.targets,
      total: selection.total,
      quota: selection.quota,
      dueCount: selection.dueCount,
    };
    if (sp.get("all")) body.all = buildRefreshTargets();
    return NextResponse.json(body);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
