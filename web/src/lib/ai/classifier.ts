/**
 * News classifier backed by the Claude Code CLI (the user's subscription) — no
 * API key required. Distinct from the report generator: we run ONE batched call
 * per refresh for all new headlines across all holdings (cheap on the usage
 * limit), from a neutral working directory so the project's CLAUDE.md / Buffett
 * skill don't auto-trigger and turn a classification into a full analysis.
 */
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

function resolveClaudeBinary(): string {
  const onPath = `${os.homedir()}/.local/bin/claude`;
  if (fs.existsSync(onPath)) return onPath;
  const base = `${os.homedir()}/Library/Application Support/Claude/claude-code`;
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const v of versions.reverse()) {
      const candidate = `${base}/${v}/claude.app/Contents/MacOS/claude`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return onPath;
}

const CLAUDE_BINARY = resolveClaudeBinary();
// Fast/cheap tier for classification; override via env if needed.
const MODEL = process.env.NEWS_CLASSIFIER_MODEL ?? "haiku";

export function classifierAvailable(): boolean {
  return fs.existsSync(CLAUDE_BINARY);
}

/** Run a one-shot Claude CLI prompt from a neutral cwd; return the final text. */
function runClaude(prompt: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      CLAUDE_BINARY,
      ["--print", "--dangerously-skip-permissions", "--model", MODEL, prompt],
      // Neutral cwd: avoids loading the project's .claude skills + CLAUDE.md.
      { cwd: os.tmpdir(), env: { ...process.env, HOME: process.env.HOME ?? os.homedir() } }
    );
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("claude CLI timed out"));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (err += c.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (/usage limit|rate limit|not authenticated|please run \/login/i.test(out + err)) {
        reject(new Error("claude CLI unavailable (auth/usage limit)"));
        return;
      }
      if (code !== 0 && !out.trim()) {
        reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 200)}`));
        return;
      }
      resolve(out);
    });
  });
}

/** Pull the first JSON array/object out of a response, tolerating prose/fences. */
function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return body.trim();
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

export type ClassifyInput = {
  ticker: string;
  companyName: string | null;
  title: string;
  summary?: string;
  publishedAt?: string;
};

const NEUTRAL: NewsClassification = {
  sentiment: "neutral",
  impact: "low",
  thesisFlag: false,
  thesisNote: null,
  aiSummary: "",
};

/**
 * Classify a batch of news items (across multiple holdings) in ONE CLI call.
 * Returns one classification per input item, in order. Throws if the CLI is
 * unavailable — the caller stores items unclassified rather than dropping them.
 */
export async function classifyNews(
  items: ClassifyInput[],
  thesisByTicker: Record<string, string>
): Promise<NewsClassification[]> {
  if (items.length === 0) return [];

  const lines = items
    .map((it, i) => {
      const date = it.publishedAt ? ` [${it.publishedAt.slice(0, 10)}]` : "";
      const snip = it.summary ? ` — ${it.summary.slice(0, 240)}` : "";
      return `${i}. (${it.ticker}, ${it.companyName ?? it.ticker})${date} ${it.title}${snip}`;
    })
    .join("\n");

  const thesisBlock =
    Object.entries(thesisByTicker)
      .filter(([, v]) => v)
      .map(([t, v]) => `- ${t}: ${v}`)
      .join("\n") || "(no prior theses on file)";

  const prompt =
    `You are classifying ASX equity news for a long-term value investor (Buffett/Graham style). ` +
    `For each news item, judge its sentiment for shareholders, its likely impact on the investment ` +
    `case, and whether it materially supports or challenges that holding's investment thesis. ` +
    `Be conservative — most routine news is neutral/low impact. Reserve "high" impact for earnings ` +
    `results, guidance changes, M&A, management/board changes, regulatory/legal actions, capital ` +
    `raisings, or dividend changes.\n\n` +
    `Investment theses on file:\n${thesisBlock}\n\n` +
    `News items:\n${lines}\n\n` +
    `Respond with ONLY a JSON array (no prose, no code fence), one object per item in the same order:\n` +
    `[{"index": <number>, "sentiment": "positive"|"neutral"|"negative", "impact": "high"|"medium"|"low", ` +
    `"thesisFlag": <boolean>, "thesisNote": <short string or null>, "aiSummary": <one concise sentence ` +
    `on why it matters to a holder>}]`;

  const text = await runClaude(prompt);
  const parsed = JSON.parse(extractJson(text)) as (Partial<NewsClassification> & { index?: number })[];

  return items.map((_, i) => {
    const c = parsed.find((p) => p.index === i) ?? parsed[i] ?? {};
    return {
      sentiment: c.sentiment ?? NEUTRAL.sentiment,
      impact: c.impact ?? NEUTRAL.impact,
      thesisFlag: c.thesisFlag ?? false,
      thesisNote: c.thesisNote ?? null,
      aiSummary: c.aiSummary ?? "",
    };
  });
}
