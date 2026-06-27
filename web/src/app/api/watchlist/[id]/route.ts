import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { watchlist, alertLog } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const watchId = parseInt(id);

  // Look up the ticker first so we can also clear its action alerts.
  // The research report is intentionally left intact.
  const row = db.select({ ticker: watchlist.ticker }).from(watchlist).where(eq(watchlist.id, watchId)).get();

  db.delete(watchlist).where(eq(watchlist.id, watchId)).run();

  if (row?.ticker) {
    db.delete(alertLog).where(eq(alertLog.ticker, row.ticker)).run();
  }

  return NextResponse.json({ ok: true });
}
