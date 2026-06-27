import { NextResponse } from "next/server";
import { checkAlerts } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const triggered = await checkAlerts();
    return NextResponse.json({ triggered: triggered.length, alerts: triggered });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
