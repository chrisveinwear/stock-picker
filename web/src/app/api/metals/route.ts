import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getMetalPositions } from "@/lib/metals";

export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  return NextResponse.json(getMetalPositions(db));
}
