/**
 * One step's report, answer first: what is recommended and how sure we are,
 * the field it was chosen from, how the gates narrowed it, what the judge
 * thought, what it cost — and then, folded away, every row it rests on.
 */

import type { StepReport as Model } from "../../../../report-model.js";
import { ReportHeader, RunFacts } from "./sections/Header";
import { Verdict } from "./sections/Verdict";
import { Candidates } from "./sections/Candidates";
import { Gates } from "./sections/Gates";
import { CoverageAndLedger } from "./sections/CoverageAndLedger";
import { Profile } from "./sections/Profile";
import { Duels, judgedFirst } from "./sections/Duels";
import { Gaps, Outputs, RawRecords, Trials } from "./sections/Evidence";
import { Fold, Section } from "./Section";
import { PlanStepCard } from "@/features/test-plan/TestPlan";

export function StepReport({ report: r }: { report: Model }) {
  // Colour follows the candidate everywhere on the page, by its row in the table.
  const colorOf = new Map(r.candidates.map((c) => [c.id, c.colorIndex]));
  const { plan } = r;
  // The judge's reasons are the evidence a reader checks the recommendation
  // against, so the judged duels are on the page, not behind a click.
  const duels = judgedFirst(r.duels);
  const shown = duels.filter((d) => d.state === "pass");
  const rest = duels.slice(shown.length);

  return (
    <article className="flex flex-col gap-5">
      <ReportHeader
        eyebrow={`运行报告 · ${r.stepId} 步骤`}
        title={<span className="font-mono">{r.runName}</span>}
        subtitle={`${r.startedAt} · ${plan.candidates} 个候选 × ${plan.inputs} 个输入 × 每组 ${plan.trialsPer} 次 = ${plan.trials} 次试验`}
      />

      <PlanStepCard step={r.tested} title="这次测了什么" />
      <Verdict verdict={r.verdict} eligible={r.eligible} total={r.candidates.length} />
      <Candidates candidates={r.candidates} control={r.control} />
      <Gates gates={r.gates} eligible={r.eligible} chosen={r.verdict.chosen} modeLabel={r.verdict.modeLabel} />
      <Profile
        absoluteRan={r.absoluteRan}
        saturated={r.saturated}
        dims={r.dims}
        profiles={r.profiles}
        preference={r.preference}
        trials={r.trials}
        colorOf={colorOf}
      />
      <CoverageAndLedger
        coverage={r.coverage}
        evaluatorErrors={r.evaluatorErrors}
        ledger={r.ledger}
        ledgerNote={r.ledgerNote}
        trialCount={r.trialCount}
      />

      {shown.length > 0 && (
        <Section title="对局证据" hint="裁判逐维度的判决和理由；两轮顺序不一致的按规则记平。">
          <Duels duels={shown} />
        </Section>
      )}

      <section aria-label="明细" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">明细</h2>
        {rest.length > 0 && (
          <Fold title={shown.length > 0 ? "没有评出结果的对局" : "裁判的逐场判决"} count={`${rest.length} 场`}>
            <Duels duels={rest} />
          </Fold>
        )}
        {r.trials.length > 0 && (
          <Fold title="每次试验" count={`${r.trials.length} 次`} defaultOpen><Trials trials={r.trials} /></Fold>
        )}
        {r.outputs.length > 0 && (
          <Fold title="候选的原始输出" count={`${r.outputs.length} 份`}><Outputs outputs={r.outputs} /></Fold>
        )}
        <Fold title="这次没有观测到的内容" count={r.gaps.length ? `${r.gaps.length} 条` : undefined}>
          <Gaps gaps={r.gaps} />
        </Fold>
        <Fold title="运行信息">
          <RunFacts facts={r.facts} />
          <RawRecords sampleTrial={r.sampleTrial} manifest={r.manifest} />
        </Fold>
      </section>

      <footer className="text-xs text-muted-foreground">
        证据文件在运行目录 <span className="font-mono">{r.dirName}/</span> 下。
      </footer>
    </article>
  );
}
