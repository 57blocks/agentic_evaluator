/**
 * The page above the per-step reports: the §8 verdict with the metric it was
 * decided on, the whole-workflow cost, and the comparisons this run did not
 * make. Independent steps render without a verdict rather than pretending a
 * workflow was tested.
 */

import { Tag } from "@/components/tag";
import type { WorkflowReport as Model } from "../../../../report-model.js";
import type { WorkflowArm } from "../../../../canon/workflow.js";
import { NO_PICK, STEPS_NOT_VALIDATED } from "../../../../report-format.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ReportHeader } from "./sections/Header";
import { Gaps } from "./sections/Evidence";
import { Code, Fold, Note, Section } from "./Section";
import { Duels } from "./sections/Duels";
import { Findings } from "./workflow/Findings";
import { Overview, Swatch } from "./workflow/Overview";
import { StepSection } from "./workflow/StepSection";

const usd = (n: number): string => `$${n.toFixed(4)}`;
const num = (n: number | null, digits = 2): string => (n === null ? "—" : n.toFixed(digits));

interface Props {
  report: Model;
  runId: string;
  /** Artifact-relative workflow root; each step's report lives under it. */
  dir: string;
}

function Chain({ report }: { report: Model }) {
  const v = report.record.e2e_validation ?? null;
  const control = v?.control_assignment ?? null;
  const proposed = v?.assignment ?? null;
  if (control === null && proposed === null) return null;
  return (
    <Section title="两组方案各用了谁" hint="两组跑的是同一批输入和试验次数。">
      <Table>
        <TableHeader>
          <TableRow><TableHead>步骤</TableHead><TableHead>对照组</TableHead><TableHead>推荐组合</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {report.record.steps.map(({ id }) => {
            const c = control?.[id] ?? "—";
            const p = proposed?.[id] ?? "—";
            return (
              <TableRow key={id}>
                <TableCell className="font-medium">{id}</TableCell>
                <TableCell className="font-mono">{c}</TableCell>
                <TableCell className={cn("font-mono", c !== p && "font-semibold")}>{p}{c !== p && " ←"}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <Note>对照组每一步都用同一个对照候选；推荐组合每一步用该步推荐的候选。箭头标出两组不同的步骤。</Note>
    </Section>
  );
}

function ArmRow({ arm, label }: { arm: WorkflowArm | null; label: string }) {
  if (arm === null) {
    return <TableRow><TableCell>{label}</TableCell><TableCell colSpan={5} className="text-muted-foreground">未运行</TableCell></TableRow>;
  }
  return (
    <TableRow>
      <TableCell className="font-medium">{label}</TableCell>
      <TableCell className="text-right font-mono">{arm.cases ?? "—"}</TableCell>
      <TableCell className="text-right font-mono">{arm.success}</TableCell>
      <TableCell className="text-right font-mono">{arm.failure}</TableCell>
      <TableCell className="text-right font-mono">{arm.undetermined}</TableCell>
      <TableCell className="text-right font-mono">{usd(arm.cost_usd)}</TableCell>
    </TableRow>
  );
}

function Arms({ report }: { report: Model }) {
  const { record } = report;
  if (!record.e2e_control && !record.e2e_proposed) return null;
  const d = record.e2e_validation?.deltas ?? null;
  return (
    <Section title="端到端结果" hint="把整条链从头跑到尾，两组各成功了多少。">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>组</TableHead><TableHead className="text-right">跑了几次</TableHead><TableHead className="text-right">成功</TableHead>
            <TableHead className="text-right">失败</TableHead><TableHead className="text-right">未判定</TableHead><TableHead className="text-right">成本</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ArmRow arm={record.e2e_control ?? null} label="对照组" />
          <ArmRow arm={record.e2e_proposed ?? null} label="推荐组合" />
        </TableBody>
      </Table>
      {d ? (
        <Note>
          按 <Code>{d.metric}</Code> 判定：推荐组合 {num(d.proposed, 4)}，对照组 {num(d.control, 4)}，提升 {num(d.improvement, 4)}；
          规格要求的最小有意义差异是 {d.mmd === null ? "未声明" : d.mmd}。
          {d.paired &&
            ` 逐例配对 ${d.paired.compared} 例：两组都成功 ${d.paired.both_success}，只有推荐组合成功 ${d.paired.proposed_only}，只有对照组成功 ${d.paired.control_only}，都失败 ${d.paired.neither}。`}
        </Note>
      ) : (
        <Note>这次判定没有用到指标差值。</Note>
      )}
    </Section>
  );
}

function Ledger({ report }: { report: Model }) {
  const l = report.record.ledger;
  const rows: Array<[string, number, boolean?]> = [
    ["候选生成", l.generation], ["成对裁判", l.judging], ["绝对打分", l.scoring], ["确定性检查", l.checks], ["重试", l.retries],
    ["各步骤小计", l.steps_total], ["端到端验证", l.e2e_total], ["合计", l.total, true],
  ];
  return (
    <Section title="花费" hint={`数据来源：${l.source}`}>
      <Table>
        <TableBody>
          {rows.map(([label, v, total]) => (
            <TableRow key={label} className={total ? "border-t-2 font-semibold" : undefined}>
              <TableCell className={total ? undefined : "text-muted-foreground"}>{label}</TableCell>
              <TableCell className="text-right font-mono">{usd(v)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Note>端到端验证是额外跑的，单独列出，没有和各步骤重复计算。</Note>
    </Section>
  );
}

function Verdict({ report }: { report: Model }) {
  const d = report.digest;
  const v = report.record.e2e_validation ?? null;
  return (
    <section aria-label="结论" className="flex flex-col gap-2 border border-l-4 border-border border-l-foreground bg-card p-5">
      <p className="text-xs font-medium text-muted-foreground">结论</p>
      <h2 className="text-lg font-semibold leading-snug">{d?.headline ?? report.verdictLine}</h2>
      <p className="text-sm text-muted-foreground">
        {v ? `端到端验证：${report.verdictLine}` : `${report.verdictLine}${STEPS_NOT_VALIDATED}`}
      </p>
    </section>
  );
}

function Advice({ rows }: { rows: NonNullable<Model["digest"]>["advice"] }) {
  return (
    <Section title="选型建议" hint="每一步按规格声明的门槛和运行模式选出，不参考裁判偏好。">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>步骤</TableHead><TableHead>推荐</TableHead><TableHead>确信度</TableHead><TableHead>理由</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.step}>
              <TableCell className="align-top font-medium">{a.step}</TableCell>
              <TableCell className="align-top">
                {a.chosen ? <span className="font-mono font-semibold text-brand">{a.chosen}</span> : <Tag tone="bad">{NO_PICK}</Tag>}
              </TableCell>
              <TableCell className="align-top whitespace-nowrap">{a.firmness}</TableCell>
              <TableCell className="align-top whitespace-normal text-muted-foreground">{a.reason}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  );
}

export function WorkflowReport({ report, runId, dir }: Props) {
  const { record } = report;
  const d = report.digest;
  const colorOf = new Map((d?.candidates ?? []).map((c) => [c.id, c]));
  const inputs = d ? [...new Set(d.inputsPerStep)].join("–") : "—";

  return (
    <article className="flex flex-col gap-5">
      <ReportHeader
        eyebrow="工作流报告"
        title={<span className="font-mono">{record.run_name}</span>}
        subtitle={`${record.steps.length} 个步骤（${record.steps.map((s) => s.id).join(" → ")}），${record.handoff ? "前一步的输出交给下一步" : "各自独立评测"}`}
      />
      {d && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-1.5"><dt className="text-muted-foreground">裁判</dt><dd className="font-mono">{d.judge ?? "—"}</dd></div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">候选</dt>
            <dd className="flex flex-wrap gap-x-3">
              {d.candidates.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 font-mono"><Swatch slot={c.colorIndex} />{c.id}</span>
              ))}
            </dd>
          </div>
          <div className="flex gap-1.5"><dt className="text-muted-foreground">样本</dt><dd>每步 {inputs} 个输入 × 每组 {d.trialsPer ?? "—"} 次</dd></div>
          <div className="flex gap-1.5"><dt className="text-muted-foreground">总花费</dt><dd className="font-mono">{usd(d.totalUsd)}</dd></div>
        </dl>
      )}

      <Verdict report={report} />
      {d && <Findings findings={d.findings} />}
      {d && <Overview steps={d.steps} candidates={d.candidates} />}
      {d?.steps.map((s, i) => <StepSection key={s.id} step={s} index={i} runId={runId} root={dir} colorOf={colorOf} />)}
      <Chain report={report} />
      <Arms report={report} />
      {d && d.advice.length > 0 && <Advice rows={d.advice} />}

      <section aria-label="明细" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">明细</h2>
        {d?.steps.map((s, i) =>
          s.report && s.report.duels.length > 0 ? (
            <Fold key={s.id} title={`步骤 ${i + 1} · ${s.id} 的逐场判决`} count={`${s.report.duels.length} 场`}>
              <Duels duels={s.report.duels} />
            </Fold>
          ) : null,
        )}
        <Fold title="花费明细" count={usd(record.ledger.total)}><Ledger report={report} /></Fold>
        <Fold title="这次没有观测或比较的内容" count={report.gaps.length ? `${report.gaps.length} 条` : undefined}>
          <Gaps gaps={report.gaps} />
        </Fold>
      </section>

      <footer className="text-xs text-muted-foreground">
        每一步的证据在运行目录 <span className="font-mono">{record.run_id}/</span> 下各自的子目录里。
      </footer>
    </article>
  );
}
