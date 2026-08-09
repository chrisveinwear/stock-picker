import { NextResponse } from "next/server";
import { getResearchAlerts } from "@/lib/research-alerts";

export const dynamic = "force-dynamic";

export type { ResearchAlert } from "@/lib/research-alerts";

export async function GET() {
  try {
    return NextResponse.json(await getResearchAlerts());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
