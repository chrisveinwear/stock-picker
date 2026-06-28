import { NextResponse } from "next/server";
import { getPortfolioNewsDigest, buildNewsDigest } from "@/lib/news-intel";
import { classifierAvailable } from "@/lib/ai/classifier";

export const dynamic = "force-dynamic";
// Refresh fans out across every holding (Firecrawl) + one batched CLI classify call.
export const maxDuration = 300;

// Read the cached digest — no live fetching.
export async function GET() {
  return NextResponse.json({
    groups: getPortfolioNewsDigest(),
    classifierAvailable: classifierAvailable(),
  });
}

// Rebuild the digest: fetch news since last fetch for every holding, classify, store.
export async function POST() {
  const run = await buildNewsDigest();
  return NextResponse.json({
    refreshed: run.refreshed,
    added: run.added,
    classified: run.classified,
    results: run.results,
    groups: getPortfolioNewsDigest(),
    classifierAvailable: classifierAvailable(),
  });
}
