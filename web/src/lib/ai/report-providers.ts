/**
 * LLM providers for research report generation.
 *
 * Two backends produce the same artefact (a raw markdown report as text):
 *  - "claude"   — the Claude Code CLI subprocess (existing path; authenticated
 *                 via the one-time `claude login`, no API key involved)
 *  - "nemotron" — OpenRouter's OpenAI-compatible chat/completions API, default
 *                 model is the free Nemotron 3 Ultra endpoint; requires
 *                 OPENROUTER_API_KEY in web/.env.local
 *
 * "auto" tries Claude first and falls back to Nemotron when Claude is
 * unavailable (binary missing, not logged in, usage/session limit reached).
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export type ReportProvider = "auto" | "claude" | "nemotron";

export type GenerationResult =
  | { ok: true; output: string; generatedBy: string }
  /** `unavailable` marks failures where trying the next provider makes sense
   *  (no credits, not logged in, no binary) vs. a hard request error. */
  | { ok: false; error: string; unavailable: boolean };

export const OPENROUTER_MODEL =
  process.env.REPORT_FALLBACK_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free";

const PROJECT_ROOT = path.join(process.cwd(), "..");

function resolveClaudeBinary(): string {
  // Prefer the symlink on PATH (stays current across updates)
  const onPath = "/Users/christophermccallum/.local/bin/claude";
  if (fs.existsSync(onPath)) return onPath;

  // Fall back to the latest versioned bundle under the Claude app directory
  const base = "/Users/christophermccallum/Library/Application Support/Claude/claude-code";
  if (fs.existsSync(base)) {
    const versions = fs.readdirSync(base).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    for (const v of versions.reverse()) {
      const candidate = `${base}/${v}/claude.app/Contents/MacOS/claude`;
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  return onPath; // will fail gracefully with "not found" error below
}

export const CLAUDE_BINARY = resolveClaudeBinary();

export function claudeAvailable(): boolean {
  return fs.existsSync(CLAUDE_BINARY);
}

/**
 * The CLI prompt tells Claude Code to follow the format "in CLAUDE.md" /
 * "from COMMODITIES.md", which it reads from disk agentically. An API model has
 * no file access, so the referenced document is appended to the prompt instead.
 */
export function inlineReferenceDoc(prompt: string, type: "stock" | "metal" | "commodity"): string {
  const file = type === "stock" ? "CLAUDE.md" : "COMMODITIES.md";
  try {
    const content = fs.readFileSync(path.join(PROJECT_ROOT, file), "utf-8");
    return `${prompt}\n\n## Reference Document — ${file}\n\nYou cannot read files; the document referenced above is reproduced here in full. Follow its analysis format and philosophy exactly:\n\n${content}`;
  } catch {
    return prompt;
  }
}

export function generateWithClaudeCli(
  prompt: string,
  emit: (text: string) => void
): Promise<GenerationResult> {
  return new Promise((resolve) => {
    if (!claudeAvailable()) {
      resolve({ ok: false, error: `Claude CLI not found at ${CLAUDE_BINARY}`, unavailable: true });
      return;
    }

    let fullOutput = "";

    const child = spawn(
      CLAUDE_BINARY,
      [
        "--output-format", "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        // Reports are print-to-stdout only. Read stays allowed (COMMODITIES.md
        // reference), but mutating tools are blocked — observed runs otherwise
        // wander off editing report files themselves (source of reportDate
        // drift and 20-minute generations).
        "--disallowedTools", "Write,Edit,NotebookEdit,Bash",
        "--print",
        prompt,
      ],
      {
        cwd: PROJECT_ROOT,
        env: { ...process.env, HOME: process.env.HOME ?? "/Users/christophermccallum" },
      }
    );

    let jsonBuf = "";
    child.stdout.on("data", (chunk: Buffer) => {
      jsonBuf += chunk.toString();
      const lines = jsonBuf.split("\n");
      jsonBuf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant") {
            for (const block of event.message?.content ?? []) {
              if (block.type === "text" && block.text) {
                fullOutput += block.text;
                emit(block.text);
              }
            }
          }
          if (event.type === "result" && event.result) {
            if (fullOutput.trim() === "") {
              fullOutput = event.result;
              emit(event.result);
            }
          }
        } catch {
          // not valid JSON, skip
        }
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      console.error("[claude stderr]", chunk.toString());
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: `Failed to start Claude CLI: ${err.message}`, unavailable: true });
    });

    child.on("close", (code) => {
      // Detect auth failure
      if (fullOutput.includes("Not logged in") || fullOutput.includes("Please run /login")) {
        resolve({
          ok: false,
          error: `Claude CLI is not authenticated. Run this once in your terminal:\n\n"${CLAUDE_BINARY}" login`,
          unavailable: true,
        });
        return;
      }

      // Detect rate/session limit — otherwise the limit message gets saved as a "report"
      if (/hit your (usage|session) limit|usage limit reached|rate limit/i.test(fullOutput)) {
        const resetMatch = fullOutput.match(/resets?[^\n]*/i);
        const resetHint = resetMatch ? ` (${resetMatch[0].trim()})` : "";
        resolve({
          ok: false,
          error: `Claude CLI usage limit reached${resetHint}.`,
          unavailable: true,
        });
        return;
      }

      if (code !== 0 && fullOutput.trim() === "") {
        resolve({ ok: false, error: `Claude CLI exited with code ${code}`, unavailable: true });
        return;
      }

      // A clean exit with (near-)empty output is still a failure — observed
      // overnight: exit 0 with ~nothing on stdout produced a 17-byte stub
      // report. Report unavailable so "auto" falls through to Nemotron.
      if (fullOutput.trim().length < 500) {
        resolve({
          ok: false,
          error: `Claude CLI exited ${code ?? 0} but produced no report (${fullOutput.trim().length} chars)`,
          unavailable: true,
        });
        return;
      }

      resolve({ ok: true, output: fullOutput, generatedBy: "claude-code" });
    });
  });
}

/**
 * The free Nemotron endpoint fails transiently a few percent of the time
 * ("Upstream idle timeout exceeded", stalls, provider overload). Retry the
 * whole generation up to 3 attempts with a short backoff; only config errors
 * (missing/invalid key, unknown model) fail immediately.
 */
export async function generateWithOpenRouter(
  prompt: string,
  emit: (text: string) => void
): Promise<GenerationResult> {
  const MAX_ATTEMPTS = 3;
  let last: GenerationResult = { ok: false, error: "not attempted", unavailable: true };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await attemptOpenRouter(prompt, emit);
    if (last.ok) return last;
    const fatal = /OPENROUTER_API_KEY|API key invalid|not found or free-endpoint/.test(last.error);
    if (fatal || attempt === MAX_ATTEMPTS) return last;
    const waitMs = attempt * 15_000;
    console.error(`[openrouter] attempt ${attempt} failed, retrying in ${waitMs / 1000}s:`, last.error);
    emit(`\n\n⚠ ${last.error}\n→ Retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS}) in ${waitMs / 1000}s…\n\n`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return last;
}

async function attemptOpenRouter(
  prompt: string,
  emit: (text: string) => void
): Promise<GenerationResult> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "OPENROUTER_API_KEY is not set in web/.env.local — cannot use the Nemotron fallback.",
      unavailable: true,
    };
  }

  // The free endpoint writes a full report slowly (5–10 min is normal), so a
  // short total timeout truncates healthy runs. Abort only when the stream
  // stalls (no bytes for IDLE_MS) or at a hard cap matching the route's
  // maxDuration. Every received chunk pushes the idle deadline out.
  const IDLE_MS = 180_000;
  const HARD_CAP_MS = 840_000;
  const controller = new AbortController();
  const hardTimer = setTimeout(
    () => controller.abort(new Error(`no completion within ${HARD_CAP_MS / 60_000} minutes`)),
    HARD_CAP_MS
  );
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(
      () => controller.abort(new Error(`stream stalled for ${IDLE_MS / 60_000} minutes`)),
      IDLE_MS
    );
  };
  const clearTimers = () => {
    clearTimeout(hardTimer);
    clearTimeout(idleTimer);
  };
  bumpIdle();

  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Stock Picker",
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimers();
    return {
      ok: false,
      error: `OpenRouter request failed: ${err instanceof Error ? err.message : String(err)}`,
      unavailable: true,
    };
  }

  if (!res.ok || !res.body) {
    clearTimers();
    const detail = await res.text().catch(() => "");
    const hint =
      res.status === 401
        ? " (API key invalid — check OPENROUTER_API_KEY)"
        : res.status === 429
        ? " (free-tier rate limit: 20 req/min, 50/day — or 1,000/day after a one-time $10 credit purchase)"
        : res.status === 404
        ? ` (model "${OPENROUTER_MODEL}" not found or free-endpoint privacy setting disabled in OpenRouter account settings)`
        : "";
    return {
      ok: false,
      error: `OpenRouter HTTP ${res.status}${hint}: ${detail.slice(0, 300)}`,
      unavailable: res.status === 429,
    };
  }

  // Parse the OpenAI-style SSE stream: `data: {json}` lines, terminated by `data: [DONE]`.
  let fullOutput = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bumpIdle();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          const delta = event.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) {
            fullOutput += delta;
            emit(delta);
          }
          // Mid-stream errors (e.g. provider overloaded) arrive as an error field
          if (event.error?.message) {
            return { ok: false, error: `OpenRouter stream error: ${event.error.message}`, unavailable: true };
          }
        } catch {
          // partial/non-JSON line, skip
        }
      }
    }
  } catch (err) {
    // Surface the abort reason (stall/hard-cap message) instead of the generic
    // "This operation was aborted" the reader throws.
    const reason = controller.signal.aborted && controller.signal.reason instanceof Error
      ? controller.signal.reason.message
      : err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: `OpenRouter stream aborted: ${reason}`,
      unavailable: false,
    };
  } finally {
    clearTimers();
  }

  // Some hosts leak chain-of-thought as <think> blocks in content — never part of the report.
  fullOutput = fullOutput.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

  if (!fullOutput) {
    return { ok: false, error: "OpenRouter returned an empty response.", unavailable: false };
  }

  return { ok: true, output: fullOutput, generatedBy: `openrouter:${OPENROUTER_MODEL}` };
}
