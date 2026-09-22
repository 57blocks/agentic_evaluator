/**
 * Immutable run manifest (protocol §7 step 3): exactly what was tested.
 * Written before the first generation so an interrupted run still says what
 * it was attempting.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { INSTALL_ROOT } from "../paths.js";
import type { Suite } from "../types.js";
import type { CandidateDef, EligibilityThresholds } from "./types.js";
import { resolveEligibility } from "./select.js";

const execFileAsync = promisify(execFile);

export interface RunManifest {
  protocol_version: string;
  run_id: string;
  run_name: string;
  step: { id: string; version: string | null };
  spec: { path: string | null; sha256: string | null };
  test_set: { id: string | null; inputs: Record<string, string> };
  candidates: Record<string, CandidateDef>;
  control_candidate: string | null;
  judge: { model: string; provider_route: string | null; methods: string[] };
  evaluators: {
    required_checks: string[];
    check_version: string | null;
    rubric_sha256: string;
    producer_template_sha256: string;
    judge_template_sha256: string;
    score_template_sha256: string;
  };
  success_criteria: { mandatory_checks: "all" } | null;
  operating_mode: string | null;
  /** Resolved gates actually used; frozen so a later default change cannot rewrite this run. */
  eligibility: EligibilityThresholds;
  minimum_meaningful_difference: number | null;
  execution: {
    trials_per_case: number;
    concurrency: number;
    timeout_ms: number;
    benchmark_mode: string;
    cache_mode: string;
  };
  harness: { name: string; version: string; git_sha: string | null; node: string };
  started_at: string;
  finished_at: string | null;
}

export interface ManifestInputs {
  runId: string;
  startedAt: string;
  concurrency: number;
  inputShas: Record<string, string>;
  rubricSha: string;
  producerTemplateSha: string;
  judgeTemplateSha: string;
  scoreTemplateSha: string;
  checkVersion: string | null;
}

async function harnessVersion(): Promise<{ name: string; version: string; git_sha: string | null }> {
  let name = "agentic-evaluator";
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(INSTALL_ROOT, "package.json"), "utf-8")) as {
      name?: string;
      version?: string;
    };
    name = pkg.name ?? name;
    version = pkg.version ?? version;
  } catch {
    // keep defaults
  }
  let git_sha: string | null = null;
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: INSTALL_ROOT });
    git_sha = stdout.trim() || null;
  } catch {
    git_sha = null;
  }
  return { name, version, git_sha };
}

export async function buildManifest(suite: Suite, m: ManifestInputs): Promise<RunManifest> {
  const harness = await harnessVersion();
  return {
    protocol_version: suite.protocolVersion ?? "0.4",
    run_id: m.runId,
    run_name: suite.runName ?? suite.suiteId,
    step: { id: suite.stepId ?? suite.step, version: suite.stepVersion ?? null },
    spec: { path: suite.specPath ?? null, sha256: suite.specSha ?? null },
    test_set: { id: suite.testSetId ?? null, inputs: m.inputShas },
    candidates: suite.candidateDefs ?? {},
    control_candidate: suite.controlCandidate ?? null,
    judge: {
      model: suite.judge,
      provider_route: "openrouter",
      methods: suite.judgeMethods ?? ["pairwise-swap", "absolute-1-5"],
    },
    evaluators: {
      required_checks: suite.requiredChecks ?? [],
      check_version: m.checkVersion,
      rubric_sha256: m.rubricSha,
      producer_template_sha256: m.producerTemplateSha,
      judge_template_sha256: m.judgeTemplateSha,
      score_template_sha256: m.scoreTemplateSha,
    },
    success_criteria: suite.successCriteria ?? null,
    operating_mode: suite.operatingMode ?? null,
    eligibility: resolveEligibility(suite.requiredChecks ?? [], suite.eligibility),
    minimum_meaningful_difference: suite.mmd ?? null,
    execution: {
      trials_per_case: suite.trials ?? 2,
      concurrency: m.concurrency,
      timeout_ms: suite.timeoutMs ?? 120_000,
      benchmark_mode: suite.benchmarkMode ?? "capability-neutral",
      cache_mode: suite.cacheMode ?? "cold",
    },
    harness: { ...harness, node: process.version },
    started_at: m.startedAt,
    finished_at: null,
  };
}
