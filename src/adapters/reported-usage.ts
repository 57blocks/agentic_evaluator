/**
 * Usage a command candidate reports about itself.
 *
 * The harness cannot see what an agent run as a command spends. A candidate
 * that can (a wrapper around Harbor, or an agent that prints its own bill)
 * leaves `.eval-usage.json` in its work dir:
 *
 *   { "cost_usd": 0.0727, "prompt_tokens": 60180, "completion_tokens": 4070,
 *     "source": "estimated" | "provider-reported" }
 *
 * `cost_usd` is required; tokens are optional; `source` defaults to
 * "provider-reported". A missing or malformed file reads as unobserved
 * ("none"), never as a measured $0, so the run's GAPS.md names the candidate
 * instead of the ledger pricing it as free.
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

const UNOBSERVED: ReportedUsage = { costUsd: 0, costSource: "none", promptTokens: 0, completionTokens: 0 };
const OBSERVED_SOURCES: ReadonlySet<CostSource> = new Set(["provider-reported", "estimated"]);

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
  const source = fields.source ?? "provider-reported";
  if (typeof source !== "string" || !OBSERVED_SOURCES.has(source as CostSource)) return null;
  const promptTokens = tokenCount(fields.prompt_tokens);
  const completionTokens = tokenCount(fields.completion_tokens);
  if (promptTokens === null || completionTokens === null) return null;
  return { costUsd: fields.cost_usd, costSource: source as CostSource, promptTokens, completionTokens };
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
