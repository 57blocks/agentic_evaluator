/**
 * "How sure" in a terminal: the same evidence as the report's section
 * (report-certainty.ts), a few lines under a step's summary table, so a run
 * can be read without opening the page.
 */

import type { ItemStats } from "../canon/item-stats.js";
import type { FirmnessEvidence } from "../canon/select.js";
import { clearsGate, fmtP } from "../canon/stats.js";

const MAX_LISTED = 5;

export interface CertaintyInput {
  chosen: string | null;
  firmness: string;
  firmnessReasons: readonly string[];
  evidence: FirmnessEvidence | null;
  items: ItemStats;
}

function gateLines(chosen: string, evidence: FirmnessEvidence | null): string[] {
  const gates = evidence?.gates ?? [];
  if (gates.length === 0) return [];
  return [
    `  how sure ${chosen} is:`,
    ...gates.map((g) => {
      const never = g.threshold >= 1 ? " (a gate of 1 can never be firm; try 0.95)" : "";
      const verdict = clearsGate(g.low, g.threshold) ? "holds" : `not shown${never}`;
      return `    ${g.gate} ${g.successes}/${g.n} → 95% ${g.low.toFixed(3)}–${g.high.toFixed(3)}, gate ${g.threshold} ${verdict}`;
    }),
  ];
}

function versusLine(evidence: FirmnessEvidence | null): string[] {
  const v = evidence?.versus_runner_up;
  if (!v) return [];
  return [
    `    vs runner-up ${v.b}: better on ${v.a_better} input(s), worse on ${v.b_better}, equal on ${v.same} — sign test p ${fmtP(v.p_value)}${v.significant ? "" : ", not significant"}`,
  ];
}

function itemsLine(items: ItemStats): string[] {
  if (items.inputs === 0) return [];
  const allFail = items.items.filter((i) => i.class === "all-fail").map((i) => i.input);
  const listed = allFail.slice(0, MAX_LISTED).join(", ") + (allFail.length > MAX_LISTED ? ", …" : "");
  const fail = allFail.length === 0 ? "" : ` · every candidate failed ${allFail.length} (check those for a harness bug): ${listed}`;
  return [`  effective N ${items.effective_n} of ${items.inputs} inputs separated the candidates${fail}`];
}

/**
 * Reasons the gate and runner-up lines above already state; select.ts words
 * them `<chosen>: <gate> …` and `<chosen> and <runner-up> cannot be told apart …`.
 */
function shownAbove(c: CertaintyInput): (reason: string) => boolean {
  if (c.chosen === null) return () => false;
  const prefixes = [
    ...(c.evidence?.gates ?? []).map((g) => `${c.chosen}: ${g.gate} `),
    ...(c.evidence?.versus_runner_up ? [`${c.chosen} and ${c.evidence.versus_runner_up.b} cannot be told apart`] : []),
  ];
  return (reason) => prefixes.some((p) => reason.startsWith(p));
}

export function certaintyLines(c: CertaintyInput): string[] {
  const isShown = shownAbove(c);
  const rest = c.firmnessReasons.filter((r) => !isShown(r));
  const why = rest.length === 0 ? [] : [`  ${c.firmness} because:`, ...rest.map((r) => `    - ${r}`)];
  return [
    ...(c.chosen === null ? [] : [...gateLines(c.chosen, c.evidence), ...versusLine(c.evidence)]),
    ...itemsLine(c.items),
    ...why,
  ];
}
