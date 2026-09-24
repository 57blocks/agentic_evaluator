/**
 * The page above the per-step reports: the §8 verdict with the metric it was
 * decided on, the whole-workflow cost, and the comparisons this run did not
 * make. Independent steps render without a verdict rather than pretending a
 * workflow was tested.
 */

import { Tag } from "@/components/tag";
import type { WorkflowReport as Model } from "../../../../report-model.js";
import type { WorkflowArm } from "../../../../canon/workflow.js";
import { NO_PICK, plural, STEPS_NOT_VALIDATED } from "../../../../report-format.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { firmnessTone } from "@/lib/tone";
import { ReportHeader } from "./sections/Header";
import { Gaps } from "./sections/Evidence";
import { Code, Fold, Note, Section } from "./Section";
import { Duels } from "./sections/Duels";
import { Findings } from "./workflow/Findings";
import { Overview, Swatch } from "./workflow/Overview";
import { StepSection } from "./workflow/StepSection";
import { StepCards } from "./workflow/StepCards";

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
    <Section title="Who each arm used" hint="Both arms ran the same inputs and the same number of trials.">
      <Table>
        <TableHeader>
          <TableRow><TableHead>Step</TableHead><TableHead>Control arm</TableHead><TableHead>Recommended combination</TableHead></TableRow>
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
      <Note>The control arm uses the same control candidate on every step; the recommended combination uses each step's recommended candidate. Arrows mark the steps where the arms differ.</Note>
    </Section>
  );
}

function ArmRow({ arm, label }: { arm: WorkflowArm | null; label: string }) {
  if (arm === null) {
    return <TableRow><TableCell>{label}</TableCell><TableCell colSpan={5} className="text-muted-foreground">Not run</TableCell></TableRow>;
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
    <Section title="End-to-end results" hint="The whole chain run start to finish: how often each arm succeeded.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Arm</TableHead><TableHead className="text-right">Runs</TableHead><TableHead className="text-right">Success</TableHead>
            <TableHead className="text-right">Failure</TableHead><TableHead className="text-right">Undetermined</TableHead><TableHead className="text-right">Cost</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <ArmRow arm={record.e2e_control ?? null} label="Control arm" />
          <ArmRow arm={record.e2e_proposed ?? null} label="Recommended combination" />
        </TableBody>
      </Table>
      {d ? (
        <Note>
          Decided on <Code>{d.metric}</Code>: recommended combination {num(d.proposed, 4)}, control arm {num(d.control, 4)}, improvement {num(d.improvement, 4)};
           the spec's minimum meaningful difference is {d.mmd === null ? "not declared" : d.mmd}.
          {d.paired &&
            ` Paired by case, ${d.paired.compared} cases: both succeeded ${d.paired.both_success}, only the recommended combination ${d.paired.proposed_only}, only the control arm ${d.paired.control_only}, neither ${d.paired.neither}.`}
        </Note>
      ) : (
        <Note>This verdict did not use a metric difference.</Note>
      )}
    </Section>
  );
}

function Ledger({ report }: { report: Model }) {
  const l = report.record.ledger;
  const rows: Array<[string, number, boolean?]> = [
    ["Candidate generation", l.generation], ["Pairwise judging", l.judging], ["Absolute scoring", l.scoring], ["Deterministic checks", l.checks], ["Retries", l.retries],
    ["Steps subtotal", l.steps_total], ["End-to-end validation", l.e2e_total], ["Total", l.total, true],
  ];
  return (
    <Section title="Spend" hint={`Source: ${l.source}`}>
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
      <Note>End-to-end validation is an extra run, listed separately and not double-counted with the steps.</Note>
    </Section>
  );
}

function Verdict({ report, runId, root }: { report: Model; runId: string; root: string }) {
  const d = report.digest;
  const v = report.record.e2e_validation ?? null;
  return (
    <section aria-label="Verdict" className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 shadow-(--shadow-card)">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Verdict</p>
        <h2 className="text-lg font-semibold leading-snug">{d?.headline ?? report.verdictLine}</h2>
      </div>
      {d && d.steps.length > 0 && (
        <StepCards steps={d.steps} advice={d.advice} chained={report.record.handoff} runId={runId} root={root} />
      )}
      <p className="text-sm text-muted-foreground">
        {v ? `End-to-end validation: ${report.verdictLine}` : `${report.verdictLine} ${STEPS_NOT_VALIDATED}`}
      </p>
    </section>
  );
}

function Advice({ rows }: { rows: NonNullable<Model["digest"]>["advice"] }) {
  return (
    <Section title="Recommendations" hint="Each step is chosen by the spec's eligibility gates and operating mode, not by judge preference.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Step</TableHead><TableHead>Recommended</TableHead><TableHead>Confidence</TableHead><TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.step}>
              <TableCell className="align-top font-medium">{a.step}</TableCell>
              <TableCell className="align-top">
                {a.chosen ? <span className="font-mono font-semibold text-brand">{a.chosen}</span> : <Tag tone="bad">{NO_PICK}</Tag>}
              </TableCell>
              <TableCell className="align-top whitespace-nowrap">
                <Tag tone={firmnessTone(a.firmnessKey)}>{a.firmness}</Tag>
              </TableCell>
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
        eyebrow="Workflow report"
        title={<span className="font-mono">{record.run_name}</span>}
        subtitle={`${record.steps.length} steps (${record.steps.map((s) => s.id).join(" → ")}), ${record.handoff ? "each step's output feeds the next" : "each evaluated independently"}`}
      />
      {d && (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
          <div className="flex gap-1.5"><dt className="text-muted-foreground">Judge</dt><dd className="font-mono">{d.judge ?? "—"}</dd></div>
          <div className="flex gap-1.5">
            <dt className="text-muted-foreground">Candidates</dt>
            <dd className="flex flex-wrap gap-x-3">
              {d.candidates.map((c) => (
                <span key={c.id} className="inline-flex items-center gap-1.5 font-mono"><Swatch slot={c.colorIndex} />{c.id}</span>
              ))}
            </dd>
          </div>
          <div className="flex gap-1.5"><dt className="text-muted-foreground">Sample</dt><dd>{plural(inputs, "input")} per step × {plural(d.trialsPer ?? "—", "trial")} each</dd></div>
          <div className="flex gap-1.5"><dt className="text-muted-foreground">Total spend</dt><dd className="font-mono">{usd(d.totalUsd)}</dd></div>
        </dl>
      )}

      <Verdict report={report} runId={runId} root={dir} />
      {d && <Findings findings={d.findings} />}
      {d && <Overview steps={d.steps} candidates={d.candidates} />}
      {d?.steps.map((s, i) => <StepSection key={s.id} step={s} index={i} runId={runId} root={dir} colorOf={colorOf} />)}
      <Chain report={report} />
      <Arms report={report} />
      {d && d.advice.length > 0 && <Advice rows={d.advice} />}

      <section aria-label="Details" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Details</h2>
        {d?.steps.map((s, i) =>
          s.report && s.report.duels.length > 0 ? (
            <Fold key={s.id} title={`Step ${i + 1} · ${s.id}: judge verdicts, duel by duel`} count={`${s.report.duels.length} duels`}>
              <Duels duels={s.report.duels} />
            </Fold>
          ) : null,
        )}
        <Fold title="Spend breakdown" count={usd(record.ledger.total)}><Ledger report={report} /></Fold>
        <Fold title="What this run did not observe or compare" count={report.gaps.length ? `${report.gaps.length} items` : undefined}>
          <Gaps gaps={report.gaps} />
        </Fold>
      </section>

      <footer className="text-xs text-muted-foreground">
        Each step's evidence is in its own subdirectory of the run directory <span className="font-mono">{record.run_id}/</span>.
      </footer>
    </article>
  );
}
