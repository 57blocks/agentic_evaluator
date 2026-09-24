/**
 * A single run: what each step recommended, who was gated and why.
 *
 * The gated candidates stay on the page, struck through rather than dropped.
 * A recommendation is only meaningful against the field it was chosen from,
 * and a list that quietly omits whoever failed the checks reads like a
 * narrower field than the one that actually ran.
 */

import { Tag } from "@/components/tag";
import { SECTION_CARD, SECTION_TITLE } from "@/components/section-style";
import type { RunStepView, RunView } from "../../catalog.js";
import { navigate } from "@/app/routes";
import { Evidence } from "@/features/evidence/Evidence";
import { runStamp } from "@/lib/format";
import { firmnessTone } from "@/lib/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

function StepCard({ step, runId }: { step: RunStepView; runId: string }) {
  const gatedIds = step.gated.map((g) => g.candidate);
  return (
    <Card className={SECTION_CARD}>
      <CardHeader>
        <CardTitle className={cn(SECTION_TITLE, "flex items-center justify-between gap-2")}>
          <span>{step.id}</span>
          <Tag tone={firmnessTone(step.firmness)}>{step.firmness}</Tag>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-[13px]">
          {step.chosen ? <>Recommended <b className="font-mono text-brand">{step.chosen}</b></> : <span className="text-bad">No recommendation</span>}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[...step.eligible, ...gatedIds].map((c) => (
            <Tag
              key={c}
              tone={gatedIds.includes(c) ? "bad" : c === step.chosen ? "brand" : "neutral"}
              className={cn("font-mono", gatedIds.includes(c) && "line-through opacity-70")}
            >
              {c}
            </Tag>
          ))}
        </div>
        {step.gated.length > 0 && (
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-xs text-muted-foreground">
            {step.gated.map((g) => (
              <li key={g.candidate}>
                <span className="font-mono">{g.candidate}</span> — {g.reason}
              </li>
            ))}
          </ol>
        )}
        <p className="text-xs text-muted-foreground">
          {step.operatingMode}
          {step.ledgerTotal != null && ` · $${step.ledgerTotal.toFixed(4)}`}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => navigate({ view: "report", runId, dir: step.dir })}
        >
          View {step.id} report
        </Button>
      </CardContent>
    </Card>
  );
}

/** Every report this run has, as the first thing under its title. */
function ReportLinks({ run }: { run: RunView }) {
  const open = (dir: string) => navigate({ view: "report", runId: run.id, dir });
  return (
    <section aria-label="Reports" className={cn(SECTION_CARD, "flex flex-wrap items-center gap-2 border border-border bg-card p-4")}>
      <h3 className={cn(SECTION_TITLE, "mr-2")}>Reports</h3>
      {run.kind === "workflow" && <Button size="sm" onClick={() => open(run.dir)}>Workflow report</Button>}
      {run.steps.map((s) => (
        <Button key={s.dir} size="sm" variant={run.kind === "workflow" ? "outline" : "default"} onClick={() => open(s.dir)}>
          {s.id} report
        </Button>
      ))}
      <span className="text-xs text-muted-foreground">Each report page can be exported as a single HTML file</span>
    </section>
  );
}

function E2eLine({ e2e }: { e2e: NonNullable<RunView["e2e"]> }) {
  return (
    <p className="text-xs text-muted-foreground">
      Single-model end-to-end control <b className="font-mono">{e2e.candidate}</b> · {e2e.chain.join(" → ")} · success{" "}
      {e2e.success} / failure {e2e.failure} / undetermined {e2e.undetermined}
    </p>
  );
}

export function RunPage({ run }: { run: RunView }) {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-semibold tabular-nums">{runStamp(run)}</h2>
        <p className="text-[13px] text-muted-foreground">
          <span className="font-mono">{run.id}</span> ·{" "}
          {run.kind === "workflow" ? "Multi-step" : "Single step"}
          {run.handoff ? " · with handoff" : " · no handoff"}
          {run.sample && " · repository sample"}
        </p>
        {run.e2e && <E2eLine e2e={run.e2e} />}
      </header>

      <ReportLinks run={run} />

      <section aria-label="Recommendation per step" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {run.steps.map((step) => (
          <StepCard key={step.id} step={step} runId={run.id} />
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className={SECTION_TITLE}>Evidence</h2>
        <Evidence run={run} />
      </section>

    </div>
  );
}
