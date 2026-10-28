/**
 * Usage a command candidate reports about itself.
 *
 * The harness cannot see what an agent run as a command spends. A command
 * that can (a wrapper copying the figure from Harbor, which ran the agent in
 * a container) leaves `.eval-usage.json` in its work dir:
 *
 *   { "cost_usd": 0.0727, "prompt_tokens": 60180, "completion_tokens": 4070 }
 *
 * It is read only when the spec declares `cli.reports_usage: true`: the work
 * dir is writable by the agent under evaluation, so the agent could otherwise
 * price itself. Even then the figure is recorded as "estimated" — the harness
 * did not observe it — and GAPS.md names the candidates that self-reported.
 * `cost_usd` is required, tokens optional. A missing or malformed file reads
 * as unobserved ("none"), never as a measured $0; so does a symlink or a file
 * over the size cap (work-file.ts), since the agent owns that directory.
 */

import { readWorkFile } from "./work-file.js";
import type { CostSource } from "../canon/types.js";
import type { TokenUsage } from "../pricing.js";

export const USAGE_FILE = ".eval-usage.json";

export interface ReportedUsage {
  costUsd: number;
  costSource: CostSource;
  promptTokens: number;
  completionTokens: number;
}

export const UNOBSERVED: ReportedUsage = { costUsd: 0, costSource: "none", promptTokens: 0, completionTokens: 0 };

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function tokenCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return isNonNegativeNumber(value) && Number.isInteger(value) ? value : null;
}

/** Validate a parsed usage file; null when any field is malformed. */
export function parseReportedUsage(raw: unknown): ReportedUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const fields = raw as Record<string, unknown>;
  if (!isNonNegativeNumber(fields.cost_usd)) return null;
  const promptTokens = tokenCount(fields.prompt_tokens);
  const completionTokens = tokenCount(fields.completion_tokens);
  if (promptTokens === null || completionTokens === null) return null;
  return { costUsd: fields.cost_usd, costSource: "estimated", promptTokens, completionTokens };
}

/** Read the candidate's usage file from its work dir; unobserved when absent or malformed. */
export async function readReportedUsage(workDir: string): Promise<ReportedUsage> {
  const read = await readWorkFile(workDir, USAGE_FILE);
  if (read === null || "refused" in read) return UNOBSERVED;
  const { text } = read;
  try {
    return parseReportedUsage(JSON.parse(text)) ?? UNOBSERVED;
  } catch {
    return UNOBSERVED;
  }
}

/**
 * `reports_usage: tokens`: the file carries tokens only, and agenteval prices
 * them (src/pricing.ts). `prompt_tokens` is input not served from or written
 * to a cache; cache reads and writes are counted apart, since they cost
 * differently:
 *
 *   { "prompt_tokens": 1200, "completion_tokens": 3400,
 *     "cache_read_tokens": 81000, "cache_write_tokens": 9000 }
 */
export function parseReportedTokens(raw: unknown): TokenUsage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as Record<string, unknown>;
  if (f.prompt_tokens === undefined || f.completion_tokens === undefined) return null;
  const input = tokenCount(f.prompt_tokens);
  const output = tokenCount(f.completion_tokens);
  const cacheRead = tokenCount(f.cache_read_tokens);
  const cacheWrite = tokenCount(f.cache_write_tokens);
  if (input === null || output === null || cacheRead === null || cacheWrite === null) return null;
  return { input, output, cacheRead, cacheWrite };
}

/** The tokens a candidate reported, or null when absent or malformed. */
export async function readReportedTokens(workDir: string): Promise<TokenUsage | null> {
  try {
    const read = await readWorkFile(workDir, USAGE_FILE);
    if (read === null || "refused" in read) return null;
    return parseReportedTokens(JSON.parse(read.text));
  } catch {
    return null;
  }
}
