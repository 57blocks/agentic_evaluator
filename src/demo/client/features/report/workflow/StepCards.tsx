/**
 * One card per step: which candidate it recommends, how firmly, and why.
 *
 * A step with no pick gets a red edge, so the step that needs a person is the
 * first thing seen rather than a clause in the middle of a sentence. Arrows
 * join the cards only when the steps really hand their output on.
 */

import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import { Tag } from "@/components/tag";
import type { AdviceRow, WorkflowStep } from "../../../../../workflow-report-model.js";
import { NO_PICK } from "../../../../../report-format.js";
import { navigate } from "@/app/routes";
import { firmnessTone } from "@/lib/tone";
import { cn } from "@/lib/utils";

interface StepCardsProps {
  steps: readonly WorkflowStep[];
  advice: readonly AdviceRow[];
  chained: boolean;
  runId: string;
  /** Artifact-relative workflow root; each step's report lives under it. */
  root: string;
}

function StepCard({ index, step, row, onOpen }: { index: number; step: WorkflowStep; row: AdviceRow | undefined; onOpen: () => void }) {
  const open = !row?.chosen;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left shadow-(--shadow-card) transition-colors",
        "hover:border-brand-2/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        open && "border-l-4 border-l-bad",
      )}
    >
      <span className="text-xs font-medium text-muted-foreground">
        {index + 1} · {step.id}
      </span>
      {row?.chosen ? (
        <span className="truncate font-mono text-base font-semibold text-brand">{row.chosen}</span>
      ) : (
        <span className="text-base font-semibold text-bad">{row ? NO_PICK : "report unreadable"}</span>
      )}
      {row && <Tag tone={firmnessTone(row.firmnessKey)}>{row.firmness}</Tag>}
      <span className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
        {row?.reason ?? step.error ?? ""}
      </span>
    </button>
  );
}

export function StepCards({ steps, advice, chained, runId, root }: StepCardsProps) {
  const rowOf = new Map(advice.map((a) => [a.step, a]));
  return (
    <div className="flex flex-col items-stretch gap-3 md:flex-row">
      {steps.map((step, i) => (
        <Fragment key={step.id}>
          {i > 0 && chained && (
            <ArrowRight aria-hidden className="size-4 shrink-0 self-center text-muted-foreground max-md:rotate-90" />
          )}
          <StepCard
            index={i}
            step={step}
            row={rowOf.get(step.id)}
            onOpen={() => navigate({ view: "report", runId, dir: `${root}/${step.dir}` })}
          />
        </Fragment>
      ))}
    </div>
  );
}
