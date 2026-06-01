import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { metalHoldings } from "@/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const body = await req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.ounces != null)      updates.ounces      = Number(body.ounces);
  if (body.avgCostAud != null)  updates.avgCostAud  = Number(body.avgCostAud);
  if (body.label != null)       updates.label       = body.label;
  if (body.location != null)    updates.location    = body.location;
  if (body.storageType != null) updates.storageType = body.storageType;
  if (body.account != null)     updates.account     = body.account;
  if (body.notes != null)       updates.notes       = body.notes;

  db.update(metalHoldings).set(updates).where(eq(metalHoldings.id, Number(id))).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  db.delete(metalHoldings).where(eq(metalHoldings.id, Number(id))).run();
  return NextResponse.json({ ok: true });
}
