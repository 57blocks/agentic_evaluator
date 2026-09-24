/**
 * Every candidate on the same inputs, side by side. Candidates that failed a
 * gate stay in the table, dimmed and marked, rather than dropped — a
 * recommendation only means something against the field it was chosen from.
 */

import type { CandidateRow, StepReport } from "../../../../../report-model.js";
import { fmtPct, fmtScore, fmtSec, fmtUsd } from "../../../../../report-format.js";
import { completionLabel } from "../../../../../report-copy.js";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { seriesColor } from "../tone";
import { Note, Section, Tag } from "../Section";

function Name({ c }: { c: CandidateRow }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span aria-hidden className="inline-block size-2.5" style={{ background: seriesColor(c.colorIndex) }} />
        <span className="font-mono font-medium">{c.id}</span>
        {c.chosen && <Tag tone="brand">Recommended</Tag>}
        {c.gated && <Tag tone="bad">Gated out</Tag>}
        {c.isControl && <Tag tone="neutral">Control</Tag>}
      </span>
      <span className="font-mono text-[11px] text-muted-foreground">{c.model} · {c.deployment}</span>
    </div>
  );
}

/** Success out of attempts, with anything abnormal said in words underneath. */
function Success({ c }: { c: CandidateRow }) {
  const tried = c.outcomes.success + c.outcomes.failure + c.outcomes.undetermined;
  const abnormal = c.states.filter(([state]) => state !== "success");
  const allSucceeded = tried > 0 && c.outcomes.success === tried;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("font-mono font-semibold", allSucceeded ? "text-ok" : c.outcomes.success === 0 ? "text-bad" : "text-warn")}>
        {c.outcomes.success} / {tried}
      </span>
      {c.outcomes.undetermined > 0 && (
        <span className="text-[11px] text-warn">{c.outcomes.undetermined} undetermined</span>
      )}
      {abnormal.map(([state, n]) => (
        <span key={state} className="text-[11px] text-bad">{n} × {completionLabel(state)}</span>
      ))}
    </div>
  );
}

function Checks({ c }: { c: CandidateRow }) {
  if (c.checkExecuted === 0) return <span className="text-muted-foreground">—</span>;
  const all = c.checkPass === c.checkExecuted;
  return <Tag tone={all ? "ok" : "bad"} className="font-mono">{c.checkPass} / {c.checkExecuted}</Tag>;
}

function WinRate({ c }: { c: CandidateRow }) {
  if (c.winRate === null) return <span className="text-muted-foreground">—</span>;
  const width = Math.max(0, Math.min(100, c.winRate));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-muted sm:inline-block">
        <span className="block h-full rounded-full bg-brand-2" style={{ width: `${width.toFixed(0)}%` }} />
      </span>
      <span className="font-mono">{fmtPct(c.winRate)}</span>
    </div>
  );
}

export function Candidates({ candidates, control }: Pick<StepReport, "candidates" | "control">) {
  return (
    <Section title="Candidates" hint="Results on the same inputs. Gated-out candidates stay in the table for comparison.">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Candidate</TableHead>
            <TableHead>Task success</TableHead>
            <TableHead className="text-right">Required check</TableHead>
            <TableHead className="text-right">Judge win rate</TableHead>
            <TableHead className="text-right">Absolute score</TableHead>
            <TableHead className="text-right">Cost per success</TableHead>
            <TableHead className="text-right">Median duration</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow
              key={c.id}
              className={cn(c.chosen && "bg-champ shadow-[inset_3px_0_0_var(--brand)] hover:bg-champ", c.gated && "text-muted-foreground")}
            >
              <TableCell className="align-top"><Name c={c} /></TableCell>
              <TableCell className="align-top"><Success c={c} /></TableCell>
              <TableCell className="text-right align-top"><Checks c={c} /></TableCell>
              <TableCell className="text-right align-top"><WinRate c={c} /></TableCell>
              <TableCell className="text-right align-top font-mono">{fmtScore(c.absolute)}</TableCell>
              <TableCell className="text-right align-top font-mono">{fmtUsd(c.costPerSuccess)}</TableCell>
              <TableCell className="text-right align-top font-mono">{fmtSec(c.p50)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Note>
        Required checks are counted over the times they actually ran. Judge win rate comes from pairwise comparison, a tie counts as half, and it is for reference only - it does not affect the recommendation.
         Absolute score is the 1-5 score the judge gives each output on its own. Cost per success counts generation only, not judging.
        {control && ` The control candidate is ${control}.`}
      </Note>
    </Section>
  );
}
