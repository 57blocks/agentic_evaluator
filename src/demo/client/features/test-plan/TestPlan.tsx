/**
 * A spec, read aloud: what each step tests, who competes, how a trial is
 * judged right or wrong, which gates a candidate must pass, how the
 * survivors are ranked, and how much work that is.
 *
 * Every row maps to a block of spec.yaml, in the order a reader would ask
 * about it — the raw file stays one click away for anyone who wants the YAML.
 */

import { Tag } from "@/components/tag";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
import type { ReactNode } from "react";
import type { PlanStep, TestPlan as Plan } from "../../../../test-plan.js";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-border py-3 first:border-t-0 first:pt-0 sm:grid-cols-[8rem_1fr] sm:gap-4">
      <div className="flex flex-col">
        <span className="text-xs font-medium">{label}</span>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 text-xs">{children}</div>
    </div>
  );
}

function Inputs({ step }: { step: PlanStep }) {
  return (
    <ul className="flex flex-col gap-1">
      {step.inputs.map((i) => (
        <li key={i.id} className="flex min-w-0 flex-wrap gap-x-2">
          <span className="font-mono">{i.id}</span>
          {i.title && <span className="min-w-0 text-muted-foreground">{i.title}</span>}
        </li>
      ))}
    </ul>
  );
}

function Candidates({ step }: { step: PlanStep }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {step.candidates.map((c) => (
        <li key={c.id} className="flex min-w-0 flex-col">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono font-medium">{c.id}</span>
            {c.isControl && <Tag tone="neutral">control</Tag>}
            <span className="font-mono text-muted-foreground">{c.model}</span>
          </span>
          <span className="text-[11px] break-all text-muted-foreground">{c.via}</span>
        </li>
      ))}
    </ul>
  );
}

function Checks({ step }: { step: PlanStep }) {
  if (step.checks.length === 0) {
    return step.mode.id === "judge-preference" ? (
      <p className="text-muted-foreground">
        This step has no deterministic check; quality is judged by the judge alone, so the verdict is at most "directional".
      </p>
    ) : (
      <p className="text-bad">
        No required check: whether the task was done right cannot be decided, so no candidate can pass the gates on outcome.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {step.checks.map((c) => (
        <li key={c.id}>
          <span className="font-mono">{c.id}</span>
          <span className="text-muted-foreground"> · {c.how}</span>
        </li>
      ))}
      <li className="text-muted-foreground">A trial counts as a task success only if it passes this.</li>
    </ul>
  );
}

function Scale({ step }: { step: PlanStep }) {
  const { generations, judgeCalls, scoreCalls } = step.scale;
  return (
    <p>
      {step.candidates.length} candidate(s) × {step.inputs.length} input(s) × {step.trials} trial(s) each ={" "}
      <b>{generations} generation(s)</b>
      <span className="text-muted-foreground">
        {judgeCalls > 0 && ` · ${judgeCalls} judge call(s)`}
        {scoreCalls > 0 && ` · ${scoreCalls} score call(s)`}
      </span>
    </p>
  );
}

export function PlanStepCard({ step, title }: { step: PlanStep; title?: string }) {
  return (
    <Card className={SECTION_CARD}>
      <CardHeader>
        <CardTitle className={SECTION_TITLE}>{title ?? `Step ${step.id}`}</CardTitle>
        {(step.task || step.inputFrom) && (
          <CardDescription>
            {step.task}
            {step.inputFrom && `${step.task ? "; " : ""}input is the output of the previous step ${step.inputFrom}`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col">
        <Row label="Test inputs" hint={`${step.inputs.length}`}><Inputs step={step} /></Row>
        <Row label="Candidates" hint={`${step.candidates.length}`}><Candidates step={step} /></Row>
        <Row label="How success is decided" hint="required check"><Checks step={step} /></Row>
        <Row label="Eligibility gates" hint="fail one and you are out">
          {step.gates.length === 0 ? (
            <p className="text-muted-foreground">No gates declared; every candidate takes part in the choice.</p>
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-4">{step.gates.map((g) => <li key={g}>{g}</li>)}</ul>
          )}
        </Row>
        <Row label="How the pick is made" hint="operating mode">
          <p><b>{step.mode.label}</b><span className="text-muted-foreground"> · {step.mode.explain}</span></p>
          <p className="text-muted-foreground">
            Minimum meaningful difference: {step.mmd === null ? "not declared: any gap counts, so the verdict is at most \"directional\"" : step.mmd}
          </p>
        </Row>
        {step.judge && (
          <Row label="Judge" hint="for reference only; does not decide the recommendation">
            <p>
              <span className="font-mono">{step.judge.model}</span>
              <span className="text-muted-foreground"> · {step.judge.methods.join(", ")}</span>
            </p>
            {step.judge.dimensions.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {step.judge.dimensions.map((d) => <Badge key={d} variant="outline" className="font-mono">{d}</Badge>)}
              </p>
            )}
          </Row>
        )}
        <Row label="Scale"><Scale step={step} /></Row>
      </CardContent>
    </Card>
  );
}

export function TestPlan({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-3">
      {(plan.chain || plan.budgetUsd !== null) && (
        <p className="text-xs text-muted-foreground">
          {plan.chain && <>Chain: <span className="font-mono">{plan.chain.join(" → ")}</span>. Each step's output feeds the next, and the whole chain is also run end to end for validation.</>}
          {plan.chain && plan.budgetUsd !== null && " "}
          {plan.budgetUsd !== null && <>Spend cap for the whole task: <b className="text-foreground">${plan.budgetUsd}</b>; the run stops when it is reached.</>}
        </p>
      )}
      {plan.steps.map((s) => <PlanStepCard key={s.id} step={s} />)}
    </div>
  );
}
