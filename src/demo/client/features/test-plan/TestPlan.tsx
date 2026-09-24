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
            {c.isControl && <Tag tone="neutral">对照</Tag>}
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
        这一步没有确定性检查，做得好不好只由裁判判断，所以结论最多「仅供参考」。
      </p>
    ) : (
      <p className="text-bad">
        没有必过检查——任务做没做对无法判定，候选不能凭结果通过门槛。
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
      <li className="text-muted-foreground">每次试验都要通过它，才算这次任务成功。</li>
    </ul>
  );
}

function Scale({ step }: { step: PlanStep }) {
  const { generations, judgeCalls, scoreCalls } = step.scale;
  return (
    <p>
      {step.candidates.length} 个候选 × {step.inputs.length} 个输入 × 每组 {step.trials} 次 ={" "}
      <b>{generations} 次生成</b>
      <span className="text-muted-foreground">
        {judgeCalls > 0 && ` · 裁判 ${judgeCalls} 次`}
        {scoreCalls > 0 && ` · 打分 ${scoreCalls} 次`}
      </span>
    </p>
  );
}

export function PlanStepCard({ step, title }: { step: PlanStep; title?: string }) {
  return (
    <Card className={SECTION_CARD}>
      <CardHeader>
        <CardTitle className={SECTION_TITLE}>{title ?? `步骤 ${step.id}`}</CardTitle>
        {(step.task || step.inputFrom) && (
          <CardDescription>
            {step.task}
            {step.inputFrom && `${step.task ? "；" : ""}输入来自上一步 ${step.inputFrom} 的输出`}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex flex-col">
        <Row label="测试输入" hint={`${step.inputs.length} 个`}><Inputs step={step} /></Row>
        <Row label="参赛候选" hint={`${step.candidates.length} 个`}><Candidates step={step} /></Row>
        <Row label="怎么判对错" hint="必过检查"><Checks step={step} /></Row>
        <Row label="门槛" hint="不满足就淘汰">
          {step.gates.length === 0 ? (
            <p className="text-muted-foreground">没有声明门槛，所有候选都参与选择。</p>
          ) : (
            <ul className="flex list-disc flex-col gap-0.5 pl-4">{step.gates.map((g) => <li key={g}>{g}</li>)}</ul>
          )}
        </Row>
        <Row label="怎么选" hint="运行模式">
          <p><b>{step.mode.label}</b><span className="text-muted-foreground"> · {step.mode.explain}</span></p>
          <p className="text-muted-foreground">
            最小有意义差异：{step.mmd === null ? "未声明——差距再小也算数，结论最多「仅供参考」" : step.mmd}
          </p>
        </Row>
        {step.judge && (
          <Row label="裁判" hint="只作参考，不参与推荐">
            <p>
              <span className="font-mono">{step.judge.model}</span>
              <span className="text-muted-foreground"> · {step.judge.methods.join("，")}</span>
            </p>
            {step.judge.dimensions.length > 0 && (
              <p className="flex flex-wrap gap-1">
                {step.judge.dimensions.map((d) => <Badge key={d} variant="outline" className="font-mono">{d}</Badge>)}
              </p>
            )}
          </Row>
        )}
        <Row label="规模"><Scale step={step} /></Row>
      </CardContent>
    </Card>
  );
}

export function TestPlan({ plan }: { plan: Plan }) {
  return (
    <div className="flex flex-col gap-3">
      {(plan.chain || plan.budgetUsd !== null) && (
        <p className="text-xs text-muted-foreground">
          {plan.chain && <>链路：<span className="font-mono">{plan.chain.join(" → ")}</span>，前一步的输出交给下一步，另外会端到端跑整条链做验证。</>}
          {plan.chain && plan.budgetUsd !== null && " "}
          {plan.budgetUsd !== null && <>整个任务的花费上限 <b className="text-foreground">${plan.budgetUsd}</b>，花到顶就停。</>}
        </p>
      )}
      {plan.steps.map((s) => <PlanStepCard key={s.id} step={s} />)}
    </div>
  );
}
