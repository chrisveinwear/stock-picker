import { NextRequest, NextResponse } from "next/server";
import { getMaterialAnnouncements, dismissNewsItem } from "@/lib/news-intel";

export const dynamic = "force-dynamic";

// List material announcement alerts (high-impact / thesis-flagged, unacknowledged).
export async function GET() {
  return NextResponse.json({ announcements: getMaterialAnnouncements() });
}

// Dismiss one by news item id: { id }.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { id?: number };
  if (typeof body.id !== "number") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  return NextResponse.json({ dismissed: dismissNewsItem(body.id) });
}
