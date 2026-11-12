/**
 * The API keys a step's model calls need, and which of them this environment
 * lacks.
 *
 * A call without its key fails inside the run, where nobody can tell it from
 * a model's own bad answer: it was recorded as malformed, once per trial, and
 * the run went on to the end. A missing key is the run's mistake, not a
 * candidate's, so `run` refuses to start without one (src/core/execute.ts)
 * and `check-task` says so beforehand (src/core/preflight.ts).
 *
 * Only calls the step will make count: a candidate that runs a CLI agent
 * brings its own environment (`cli.env`, checked separately), and the judge
 * is called only when the step declares a judging method.
 */

import { adapterIdOf } from "../adapters/types.js";
import { apiKeyEnvOf, endpointOf, type ModelEndpoint } from "../providers/index.js";
import type { Suite } from "../types.js";
import { methodsOf } from "./plan.js";

export interface MissingKey {
  /** Who would make the call: a candidate id, or `judge <model>`. */
  who: string;
  route: ModelEndpoint["route"];
  env: string;
}

/** The key this endpoint needs, when it is not set; empty counts as unset, since the call rejects it just the same. */
function missing(who: string, endpoint: ModelEndpoint): MissingKey[] {
  const env = apiKeyEnvOf(endpoint);
  return env && !process.env[env] ? [{ who, route: endpoint.route, env }] : [];
}

/** A candidate's key, unless it runs a CLI agent. */
function candidateKey(suite: Suite, id: string): MissingKey[] {
  const def = suite.candidateDefs?.[id];
  if (!def || adapterIdOf(def, suite.producer ?? "prompt") === "agent-cli") return [];
  return missing(id, endpointOf(def));
}

/** The keys one step's calls need: its candidates', and the judge's when it judges. */
export function missingModelKeys(suite: Suite): MissingKey[] {
  const { pairwise, absolute } = methodsOf(suite);
  const judge = (pairwise || absolute) && suite.judgeEndpoint ? missing(`judge ${suite.judge}`, suite.judgeEndpoint) : [];
  return [...suite.candidates.flatMap((id) => candidateKey(suite, id)), ...judge];
}

/**
 * The keys a workflow's end-to-end validation needs beyond its steps': the
 * control candidate runs every step, and the end-to-end judge is called
 * whatever the steps' own judging methods are.
 */
export function missingE2eKeys(chain: readonly Suite[]): MissingKey[] {
  const root = chain[0];
  if (!root) return [];
  const control = root.controlCandidate ? chain.flatMap((s) => candidateKey(s, root.controlCandidate!)) : [];
  const judge = root.e2eJudge && root.judgeEndpoint ? missing(`end-to-end judge ${root.judge}`, root.judgeEndpoint) : [];
  return [...control, ...judge];
}

export function describeMissingKey(k: MissingKey): string {
  return `${k.who}: provider_route ${k.route} needs ${k.env}, which is not set (export it, or put it in .env.local)`;
}
