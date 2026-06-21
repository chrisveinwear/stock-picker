import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { researchReports } from "@/db/schema";

const REPORTS_DIR = path.join(process.cwd(), "reports");

export async function DELETE(req: NextRequest) {
  const { ticker } = await req.json() as { ticker: string };

  if (!ticker) {
    return NextResponse.json({ error: "ticker required" }, { status: 400 });
  }

  const db = getDb();
  db.delete(researchReports).where(eq(researchReports.ticker, ticker)).run();

  const normTicker = ticker.replace(".AX", "").replace(/\s+/g, "_").toUpperCase();
  const dir = path.join(REPORTS_DIR, normTicker);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true });
  }

  return NextResponse.json({ ok: true });
}
