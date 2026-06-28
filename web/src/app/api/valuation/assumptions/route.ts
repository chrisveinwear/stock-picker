import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { valuationAssumptions } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { DEFAULTS } from "@/lib/valuation/assumptions";

export const dynamic = "force-dynamic";

/** GET — file defaults + all DB overrides. */
export async function GET() {
  try {
    const db = getDb();
    const overrides = db.select().from(valuationAssumptions).all();
    return NextResponse.json({ defaults: DEFAULTS, overrides });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * PUT — upsert an assumption override.
 * Body: { scope: "global"|sector|ticker, key, value, note? }
 */
export async function PUT(req: NextRequest) {
  try {
    const { scope, key, value, note } = (await req.json()) as {
      scope: string; key: string; value: number; note?: string;
    };
    if (!scope || !key || typeof value !== "number" || !Number.isFinite(value)) {
      return NextResponse.json({ error: "scope, key and a finite numeric value are required" }, { status: 400 });
    }
    const db = getDb();
    const now = new Date().toISOString();
    db.insert(valuationAssumptions)
      .values({ scope, key, value, note: note ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: [valuationAssumptions.scope, valuationAssumptions.key],
        set: { value, note: note ?? null, updatedAt: now },
      })
      .run();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/** DELETE — remove an override. Body: { scope, key } */
export async function DELETE(req: NextRequest) {
  try {
    const { scope, key } = (await req.json()) as { scope: string; key: string };
    const db = getDb();
    db.delete(valuationAssumptions)
      .where(and(eq(valuationAssumptions.scope, scope), eq(valuationAssumptions.key, key)))
      .run();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
