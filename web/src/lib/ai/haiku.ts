/**
 * Lightweight Anthropic (Claude Haiku) client for cheap, fast classification.
 *
 * Distinct from the report-generation path (which spawns the Claude CLI under the
 * user's subscription). This is for high-frequency, low-cost work — classifying
 * news per holding — and needs ANTHROPIC_API_KEY in web/.env.local. The key is
 * read lazily so a missing key degrades gracefully instead of crashing at import.
 */
import Anthropic from "@anthropic-ai/sdk";

// Haiku 4.5 — fast/cheap, the right tier for per-item news classification.
const MODEL = "claude-haiku-4-5-20251001";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  if (!client) client = new Anthropic({ apiKey });
  return client;
}

export function anthropicConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Pull the first JSON array/object out of a model response, tolerating prose/fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return body.trim();
  // Walk to the matching close bracket.
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    if (body[i] === open) depth++;
    else if (body[i] === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start).trim();
}

export type NewsClassification = {
  sentiment: "positive" | "neutral" | "negative";
  impact: "high" | "medium" | "low";
  thesisFlag: boolean;
  thesisNote: string | null;
  aiSummary: string;
};

type RawClassification = Partial<NewsClassification> & { index?: number };

/**
 * Classify a batch of news headlines for one holding in a single Haiku call.
 * Returns one classification per input item, in order. On any failure the caller
 * should fall back to storing items unclassified rather than dropping them.
 */
export async function classifyNewsBatch(
  ticker: string,
  companyName: string | null,
  items: { title: string; summary?: string; publishedAt?: string }[],
  thesisContext: string
): Promise<NewsClassification[]> {
  if (items.length === 0) return [];

  const system =
    "You are an equity analyst assistant for a long-term value investor (Buffett/Graham style) " +
    "covering ASX-listed companies. For each news item, judge its sentiment for shareholders, " +
    "its likely impact on the investment case, and whether it challenges or supports the stated " +
    "investment thesis. Be conservative: most routine news is neutral/low impact. Reserve 'high' " +
    "impact for earnings results, guidance changes, M&A, management/board changes, regulatory or " +
    "legal actions, capital raisings, or dividend changes. Respond with ONLY a JSON array.";

  const numbered = items
    .map((it, i) => {
      const date = it.publishedAt ? ` [${it.publishedAt.slice(0, 10)}]` : "";
      const snip = it.summary ? `\n   ${it.summary.slice(0, 300)}` : "";
      return `${i}.${date} ${it.title}${snip}`;
    })
    .join("\n\n");

  const user =
    `Company: ${companyName ?? ticker} (${ticker})\n\n` +
    `Investment thesis context:\n${thesisContext || "(no prior thesis on file)"}\n\n` +
    `News items:\n${numbered}\n\n` +
    `Return a JSON array with one object per item, in the same order, each:\n` +
    `{"index": <number>, "sentiment": "positive"|"neutral"|"negative", ` +
    `"impact": "high"|"medium"|"low", "thesisFlag": <boolean — true only if it materially ` +
    `supports or challenges the thesis above>, "thesisNote": <short string or null — which ` +
    `assumption/driver it touches>, "aiSummary": <one concise sentence on why it matters to a holder>}`;

  const msg = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: user }],
  });

  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = JSON.parse(extractJson(text)) as RawClassification[];

  // Align to input order; fill any gaps with a safe neutral default.
  return items.map((_, i) => {
    const c = parsed.find((p) => p.index === i) ?? parsed[i] ?? {};
    return {
      sentiment: c.sentiment ?? "neutral",
      impact: c.impact ?? "low",
      thesisFlag: c.thesisFlag ?? false,
      thesisNote: c.thesisNote ?? null,
      aiSummary: c.aiSummary ?? "",
    };
  });
}
