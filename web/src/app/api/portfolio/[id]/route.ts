import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { portfolioHoldings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const db = getDb();
  db.update(portfolioHoldings)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(portfolioHoldings.id, parseInt(id)))
    .run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.delete(portfolioHoldings).where(eq(portfolioHoldings.id, parseInt(id))).run();
  return NextResponse.json({ ok: true });
}
