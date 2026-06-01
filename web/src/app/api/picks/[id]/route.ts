import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { stockPicks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();
  db.update(stockPicks).set({ ...body, updatedAt: new Date().toISOString() }).where(eq(stockPicks.id, parseInt(id))).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.delete(stockPicks).where(eq(stockPicks.id, parseInt(id))).run();
  return NextResponse.json({ ok: true });
}
