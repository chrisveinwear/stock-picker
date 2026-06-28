import { NextResponse } from "next/server";
import { getPortfolioNewsDigest, buildNewsDigest } from "@/lib/news-intel";
import { anthropicConfigured } from "@/lib/ai/haiku";

export const dynamic = "force-dynamic";
// Refresh fans out across every holding (Firecrawl + Haiku per ticker).
export const maxDuration = 300;

// Read the cached digest — no live fetching.
export async function GET() {
  return NextResponse.json({
    groups: getPortfolioNewsDigest(),
    anthropicConfigured: anthropicConfigured(),
  });
}

// Rebuild the digest: fetch news since last fetch for every holding, classify, store.
export async function POST() {
  const results = await buildNewsDigest();
  const added = results.reduce((sum, r) => sum + r.added, 0);
  return NextResponse.json({
    refreshed: results.length,
    added,
    results,
    groups: getPortfolioNewsDigest(),
    anthropicConfigured: anthropicConfigured(),
  });
}
