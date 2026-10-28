/**
 * The judge on a workflow's end product (`workflow.e2e.judge`): for each case
 * both arms delivered, which delivery is better — the single-model control's
 * or the proposed combination's. The arms' rates decide adoption; this
 * informs, the way a step's judge sits beside its pick.
 */

import fs from "node:fs/promises";
import { renderArtifacts } from "../adapters/deliverable.js";
import type { ArtifactFile } from "../adapters/types.js";
import type { BudgetGuard } from "../canon/budget.js";
import { matchesShow } from "../canon/show.js";
import { judgePair } from "../judge.js";
import type { LlmTrace } from "../llm.js";
import { resolveTaskAsset } from "../paths.js";
import type { E2eJudgeConfig, Suite } from "../types.js";

/** What an arm delivered for one case: the last step's files. */
export type Deliveries = Map<string, readonly ArtifactFile[]>;

export const caseKey = (input: string, trial: number): string => `${input}#${trial}`;

export interface E2eJudgedCase {
  input: string;
  trial: number;
  /** Which arm's delivery the judge preferred, after the order swap. */
  winner: "control" | "proposed" | "tie";
  reason?: string;
  dimensions: Record<string, "control" | "proposed" | "tie">;
}

export interface E2eJudgement {
  model: string;
  rubric_file: string;
  /** It informs; the arms' rates against the gates decide adoption. */
  role: "informs";
  cases: E2eJudgedCase[];
  wins: { control: number; proposed: number; tie: number };
  /** Cases both arms delivered but the judge did not reach (budget, errors). */
  not_judged: Array<{ input: string; trial: number; reason: string }>;
  cost_usd: number;
}

function shown(files: readonly ArtifactFile[], show: readonly string[] | undefined): string {
  const kept = show && show.length > 0 ? files.filter((f) => matchesShow(f.path, show)) : files;
  return renderArtifacts(kept);
}

const side = (w: "a" | "b" | "tie"): E2eJudgedCase["winner"] => (w === "a" ? "control" : w === "b" ? "proposed" : "tie");

export async function judgeDeliveries(params: {
  root: Suite;
  config: E2eJudgeConfig;
  control: Deliveries;
  proposed: Deliveries;
  budget?: BudgetGuard;
  trace?: LlmTrace;
  /** The judge call; tests substitute one that does not bill. */
  judge?: typeof judgePair;
}): Promise<E2eJudgement> {
  const judge = params.judge ?? judgePair;
  const { root, config, control, proposed, budget } = params;
  const rubric = await fs.readFile(await resolveTaskAsset(root.taskRoot, config.rubricFile), "utf-8");
  const out: E2eJudgement = {
    model: root.judge,
    rubric_file: config.rubricFile,
    role: "informs",
    cases: [],
    wins: { control: 0, proposed: 0, tie: 0 },
    not_judged: [],
    cost_usd: 0,
  };
  for (const [key, controlFiles] of control) {
    const proposedFiles = proposed.get(key);
    if (!proposedFiles) continue;
    const [input, trialText] = key.split("#") as [string, string];
    const trial = Number(trialText);
    if (budget && !budget.allows("judging")) {
      out.not_judged.push({ input, trial, reason: "budget limit reached" });
      continue;
    }
    try {
      const judged = await judge({
        judgeModel: root.judge,
        judgeEndpoint: root.judgeEndpoint,
        rubric,
        dimensions: config.dimensions,
        inputSlug: input,
        a: "control",
        aText: shown(controlFiles, config.show),
        b: "proposed",
        bText: shown(proposedFiles, config.show),
        timeoutMs: root.timeoutMs ?? 240_000,
        trace: params.trace,
        traceContext: { phase: "e2e-judge", input, trial },
      });
      budget?.add(judged.usage.costUsd + judged.usage.retryCostUsd);
      out.cost_usd += judged.usage.costUsd + judged.usage.retryCostUsd;
      const winner = side(judged.overall.resolved);
      out.wins[winner] += 1;
      out.cases.push({
        input,
        trial,
        winner,
        ...(judged.overall.reason ? { reason: judged.overall.reason } : {}),
        dimensions: Object.fromEntries(Object.entries(judged.dimensions).map(([d, v]) => [d, side(v.resolved)])),
      });
    } catch (err) {
      out.not_judged.push({ input, trial, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
