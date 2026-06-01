import { NextRequest, NextResponse } from "next/server";
import { seedTokensFromEnv } from "@/lib/sharesight";

export const dynamic = "force-dynamic";

/**
 * POST /api/sharesight/seed-tokens
 * Body: { accessToken, refreshToken, expiresIn? }
 * Call this after a fresh OAuth2 exchange to persist tokens to disk.
 * Only usable from localhost for safety.
 */
export async function POST(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
    return NextResponse.json({ error: "Only callable from localhost" }, { status: 403 });
  }

  const body = await req.json();
  const { accessToken, refreshToken, expiresIn = 1800 } = body;

  if (!accessToken || !refreshToken) {
    return NextResponse.json({ error: "accessToken and refreshToken required" }, { status: 400 });
  }

  seedTokensFromEnv(accessToken, refreshToken, expiresIn);
  return NextResponse.json({ ok: true, message: "Tokens persisted to data/sharesight-tokens.json" });
}
