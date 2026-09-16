/**
 * Code-generation producer — standalone (NOT the production LangGraph worker).
 *
 * The production coding path is deeply coupled to `WorkerState` + a disk project
 * + a tool loop, so it can't be reproduced fairly in an isolated eval. Per the
 * plan, we instead measure each model's *bare* coding ability on a few small,
 * self-contained module specs: one generation → parse the file blocks → an
 * objective `tsc --noEmit` gate (see `check.ts`) + an LLM quality judge.
 *
 * Self-contained: imports only the thin OpenRouter client from `llm.js`, never
 * from `src/`.
 */

import { complete, type LlmTrace } from "../llm.js";
import type { CostSource } from "../canon/types.js";

/** One parsed source file from a model's output. */
export interface CodeFile {
  path: string;
  content: string;
}

export interface CodeGenOptions {
  temperature?: number;
  timeoutMs?: number;
  trace?: LlmTrace;
  traceContext?: Record<string, unknown>;
  /**
   * Fallback file name used only when the model ignores the ```file:<path>```
   * convention and emits a single bare code block. Extension is auto-picked
   * (.tsx when the block looks like JSX) unless this is supplied.
   */
  fallbackName?: string;
}

export interface CodeGenResult {
  text: string;
  files: CodeFile[];
  costUsd: number;
  costSource: CostSource;
  cachedTokens?: number;
  ms: number;
  promptTokens: number;
  completionTokens: number;
  provider?: string;
  finishReason?: string;
  refusal?: string;
}

/** `file:<path>` block extractor — same shape as the production code-gen agent. */
const FILE_BLOCK_RE = /```file:([^\n]+)\n([\s\S]*?)```/g;
/** First bare fenced block (```lang\n...```), used only for the fallback. */
const BARE_BLOCK_RE = /```([a-zA-Z0-9]*)\n([\s\S]*?)```/;

/** Heuristic: does this source look like it contains JSX (→ needs .tsx)? */
function looksLikeJsx(lang: string, content: string): boolean {
  if (lang === "tsx" || lang === "jsx") return true;
  // A return of an element, or a self-closing/opening tag with a capitalized or
  // lowercase tag name — good enough to disambiguate .ts vs .tsx for the gate.
  return /<[A-Za-z][\w.]*(\s[^>]*)?\/?>/.test(content) && /\breturn\b/.test(content);
}

/**
 * Parse model output into source files.
 *
 * Primary path: every ```file:<path>``` block. Fallback (model ignored the
 * convention and produced a single plain code block): treat that block as one
 * file, naming it `mod.ts` / `mod.tsx` (or `fallbackName`). Returns [] when the
 * output has no code at all — the caller records that as a failed check.
 */
export function parseFileBlocks(
  text: string,
  fallbackName?: string,
): CodeFile[] {
  const files: CodeFile[] = [];
  const seen = new Set<string>();
  FILE_BLOCK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FILE_BLOCK_RE.exec(text)) !== null) {
    const filePath = match[1].trim().replace(/^["'`]|["'`]$/g, "");
    const content = match[2];
    if (filePath && content && !seen.has(filePath)) {
      seen.add(filePath);
      files.push({ path: filePath, content });
    }
  }
  if (files.length > 0) return files;

  // Fallback — single bare code block.
  const bare = BARE_BLOCK_RE.exec(text);
  if (bare && bare[2].trim()) {
    const lang = bare[1].toLowerCase();
    const content = bare[2];
    const name =
      fallbackName ?? (looksLikeJsx(lang, content) ? "mod.tsx" : "mod.ts");
    return [{ path: name, content }];
  }

  return [];
}

/**
 * Generate code for a self-contained task spec using `model`, then parse the
 * emitted files. The spec text itself instructs the ```file:<path>``` output
 * format; a short preamble reinforces it for models that skip instructions.
 */
/** Fixed preamble prepended to every task spec. Hashed into the trial identity. */
export const CODEGEN_PREAMBLE = [
  "You are an expert TypeScript engineer.",
  "Implement the task below to the letter. Output ONLY the source file(s),",
  "each wrapped in a fenced block whose info string is `file:<path>`, e.g.",
  "```file:utils.ts",
  "// code…",
  "```",
  "Do not add prose, tests, or usage examples outside the file blocks.",
  "",
  "---",
  "",
].join("\n");

/** Bump when the preamble or parsing rules change materially. */
export const CODEGEN_PRODUCER_VERSION = "1";

export async function produceCode(
  taskSpec: string,
  model: string,
  opts: CodeGenOptions = {},
): Promise<CodeGenResult> {
  const prompt = CODEGEN_PREAMBLE + taskSpec;

  const r = await complete({
    model,
    prompt,
    temperature: opts.temperature ?? 0.2,
    timeoutMs: opts.timeoutMs,
    trace: opts.trace,
    traceContext: opts.traceContext,
  });

  return {
    text: r.text,
    files: parseFileBlocks(r.text, opts.fallbackName),
    costUsd: r.costUsd,
    costSource: r.costSource,
    cachedTokens: r.cachedTokens,
    ms: r.ms,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    provider: r.provider,
    finishReason: r.finishReason,
    refusal: r.refusal,
  };
}
