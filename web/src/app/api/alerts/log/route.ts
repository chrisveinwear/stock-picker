import { NextResponse } from "next/server";
import { getAlertLog, dismissAlert } from "@/lib/alerts";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(getAlertLog());
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const { id } = await req.json();
    dismissAlert(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
