import { NextResponse } from "next/server";
import { checkAlerts } from "@/lib/alerts";

export async function GET() {
  try {
    const alerts = await checkAlerts();
    return NextResponse.json(alerts);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
