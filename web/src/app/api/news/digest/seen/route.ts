import { NextRequest, NextResponse } from "next/server";
import { markNewsSeen } from "@/lib/news-intel";

export const dynamic = "force-dynamic";

// Mark news items as seen — all held (no body) or a single ticker ({ ticker }).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { ticker?: string };
  const changed = markNewsSeen(body.ticker);
  return NextResponse.json({ changed });
}
