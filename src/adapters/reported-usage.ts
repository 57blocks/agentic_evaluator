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
 * as unobserved ("none"), never as a measured $0.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { CostSource } from "../canon/types.js";

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
  let text: string;
  try {
    text = await fs.readFile(path.join(workDir, USAGE_FILE), "utf-8");
  } catch {
    return UNOBSERVED;
  }
  try {
    return parseReportedUsage(JSON.parse(text)) ?? UNOBSERVED;
  } catch {
    return UNOBSERVED;
  }
}
