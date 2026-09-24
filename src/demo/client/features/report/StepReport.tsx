/**
 * One step's report, answer first: what is recommended and how sure we are,
 * the field it was chosen from, how the gates narrowed it, what the judge
 * thought, what it cost — and then, folded away, every row it rests on.
 */

import type { StepReport as Model } from "../../../../report-model.js";
import { plural } from "../../../../report-format.js";
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
        eyebrow={`Run report · step ${r.stepId}`}
        title={<span className="font-mono">{r.runName}</span>}
        subtitle={`${r.startedAt} · ${plural(plan.candidates, "candidate")} × ${plural(plan.inputs, "input")} × ${plural(plan.trialsPer, "trial")} each = ${plural(plan.trials, "trial")}`}
      />

      <PlanStepCard step={r.tested} title="What was tested" />
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
        <Section title="Duel evidence" hint="The judge's verdict and reason on each dimension; when the two orderings disagree, the rule records a tie.">
          <Duels duels={shown} />
        </Section>
      )}

      <section aria-label="Details" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">Details</h2>
        {rest.length > 0 && (
          <Fold title={shown.length > 0 ? "Duels with no result" : "Judge verdicts, duel by duel"} count={`${rest.length} duels`}>
            <Duels duels={rest} />
          </Fold>
        )}
        {r.trials.length > 0 && (
          <Fold title="Every trial" count={`${r.trials.length} trials`} defaultOpen><Trials trials={r.trials} /></Fold>
        )}
        {r.outputs.length > 0 && (
          <Fold title="Raw candidate outputs" count={`${r.outputs.length} outputs`}><Outputs outputs={r.outputs} /></Fold>
        )}
        <Fold title="What this run did not observe" count={r.gaps.length ? `${r.gaps.length} items` : undefined}>
          <Gaps gaps={r.gaps} />
        </Fold>
        <Fold title="Run information">
          <RunFacts facts={r.facts} />
          <RawRecords sampleTrial={r.sampleTrial} manifest={r.manifest} />
        </Fold>
      </section>

      <footer className="text-xs text-muted-foreground">
        Evidence files are in the run directory <span className="font-mono">{r.dirName}/</span>.
      </footer>
    </article>
  );
}
