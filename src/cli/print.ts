/**
 * Render run events to a terminal.
 *
 * The only place in the codebase that formats a run for a human. Everything
 * upstream of here carries values; the sentence is built once, here, so that
 * changing how a run reads never means touching the driver.
 */

import type { RunEvent, RunEventSink, StepPlan } from "../core/events.js";

function usd(n: number, places = 4): string {
  return `$${n.toFixed(places)}`;
}

function planLines(p: StepPlan): string[] {
  const pairwise = p.pairs > 0 ? `${p.pairs} pairs (${p.judgeCalls} judge calls, up to 3 attempts each)` : "off";
  const absolute = p.scoreCalls > 0 ? `${p.scoreCalls} calls` : "off";
  return [
    `\n▶ ${p.suiteId} / ${p.step} [${p.producer}] — ${p.candidates} candidates × ${p.inputs} inputs × ${p.trials} trials`,
    `  generations ${p.generations} · pairwise ${pairwise} · absolute ${absolute}`,
    `  judge ${p.judge} · concurrency ${p.concurrency}${p.reuse ? " · reuse ON" : ""}${
      p.budgetUsd === null ? "" : ` · budget $${p.budgetUsd}`
    }`,
    `  benchmark ${p.benchmarkMode} · cache ${p.cacheMode} · directional ${p.directional ? "yes" : "no"}`,
  ];
}

/** One line per event, in the shape the harness has always printed. */
export function formatEvent(e: RunEvent): string[] {
  switch (e.type) {
    case "step.planned":
      return planLines(e.plan);
    case "workflow.planned": {
      const { chain, controlCandidate, perArm } = e.e2e;
      return [
        `\n  e2e control ${controlCandidate ?? "none"}: ${chain.join(" → ")} · ${perArm} generations (no judge)`,
        `  e2e validation: one more arm of ${perArm} generations if the step recommendations propose a combination other than the control — up to ${perArm * 2} in total\n`,
      ];
    }
    case "preview.only":
      return ["Preview only. Re-run with --yes (or EVAL_YES=1) to execute."];
    case "phase": {
      const label = e.phase === "judging" ? "Judging (pairwise)" : e.phase === "scoring" ? "Scoring (absolute 1–5)" : "Generating";
      return [e.declared ? `\n▶ ${label}…\n` : `\n▶ ${label} — off by spec\n`];
    }
    case "trial": {
      const who = `${e.candidate} · ${e.input} · t${e.trial}`;
      if (e.reusedFrom) return [`  reuse  ${who}  ← ${e.reusedFrom}`];
      if (e.state === "skipped") return [`  skip   ${who} — budget limit reached`];
      if (e.error) return [`  ${e.state.padEnd(8)} ${who}: ${e.error}`];
      const cost = e.costUsd === undefined ? "" : `, ${usd(e.costUsd)} ${e.costSource ?? ""}`;
      const secs = e.ms === undefined ? "" : `${(e.ms / 1000).toFixed(1)}s`;
      const check = e.check === undefined ? "" : ` · tsc ${e.check}`;
      return [`  ${e.state.padEnd(8)} ${who} (${secs}${cost})${check}`];
    }
    case "judge":
      return e.ok
        ? [`  judge  ${e.a} vs ${e.b} · ${e.input}`]
        : [`  judge EVALUATOR_ERROR  ${e.a} vs ${e.b} · ${e.input}: ${e.error ?? ""}`];
    case "score":
      return e.ok
        ? [`  score  ${e.candidate} · ${e.input} · t${e.trial}`]
        : [`  score EVALUATOR_ERROR  ${e.candidate} · ${e.input} · t${e.trial}: ${e.error ?? ""}`];
    case "budget.stopped":
      return [
        `⚠ budget limit ${usd(e.limitUsd ?? 0, 2)} reached after ${usd(e.spentUsd)} — skipped ${e.skipped.generation} generation(s), ${e.skipped.judging} judgement(s), ${e.skipped.scoring} scoring call(s); this run is partial (see GAPS.md)`,
      ];
    case "integrity.gaps":
      return [
        `⚠ ${e.gaps} wall-clock gap(s) > ${e.thresholdMs / 60000} min in the trace — host suspended? durations unreliable (see GAPS.md)`,
      ];
    case "step.done":
      return [
        ...(e.markdown ? [`\n${e.markdown}\n`] : []),
        `✔ ${e.dir}/ — ${e.trials} trials, ${e.evaluations} evaluator rows, ${e.traceEvents} trace events, ledger total ${usd(e.ledgerTotal)} (${e.ledgerSource}), recommend ${e.chosen ?? "none"} (${e.firmness})${e.html ? ", report.html" : ""}`,
      ];
    case "e2e.arm.start":
      return [`\n▶ ${e.armId} — ${Object.entries(e.assignment).map(([s, c]) => `${s}:${c}`).join(" → ")}`];
    case "e2e.arm.done":
      return [
        `✔ ${e.armId}${e.candidate ? ` ${e.candidate}` : ""}: ${e.success} success / ${e.failure} failure / ${e.undetermined} undetermined`,
      ];
    case "e2e.validated":
      return [`✔ e2e validation: ${e.verdict} (${e.firmness}) — ${e.reason}`];
    case "run.done": {
      const picks = e.steps.map((s) => `${s.id}:${s.chosen ?? "none"}`).join(", ");
      return [
        `✔ ${e.dir}/ — ${e.steps.length} independent steps · ${picks} · total ${usd(e.totalUsd)}${e.html ? ", report.html" : ""}`,
      ];
    }
  }
}

/** A sink that writes to stdout. */
export function consoleSink(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): RunEventSink {
  return (event) => {
    for (const line of formatEvent(event)) write(line);
  };
}
