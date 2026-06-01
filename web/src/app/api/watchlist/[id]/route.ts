import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { watchlist } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.delete(watchlist).where(eq(watchlist.id, parseInt(id))).run();
  return NextResponse.json({ ok: true });
}
