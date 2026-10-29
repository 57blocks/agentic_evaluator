/**
 * The same input, every candidate's answer beside the others. The aggregate
 * tables say who won; this is where a reader sees it for themselves, in
 * exactly the text the judge saw. Native <details> per input, so it still
 * works in an exported file.
 */

import type { StepReport } from "../../../../../report-model.js";
import { SIDE_BY_SIDE_MAX_INPUTS, sideBySideOf, type SideBySideRow } from "../../../../../report-side-by-side.js";
import { Fold, Section } from "../Section";

function Row({ row }: { row: SideBySideRow }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
      {row.cells.map((c) => (
        <article key={c.candidate} className="flex min-w-0 flex-col gap-1.5 border border-border p-2">
          <header className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs font-semibold">{c.candidate}</span>
            <span className="text-[11px] text-muted-foreground">
              {c.output?.text === null || c.output === null ? "no raw output saved" : `${c.output.totalChars.toLocaleString()} characters`}
            </span>
          </header>
          {c.output?.text != null && (
            <pre className="max-h-[520px] overflow-auto bg-muted p-2 font-mono text-xs whitespace-pre-wrap break-words">{c.output.text}</pre>
          )}
        </article>
      ))}
    </div>
  );
}

export function SideBySide({ outputs, candidates, open }: Pick<StepReport, "outputs" | "candidates"> & { open: boolean }) {
  const rows = sideBySideOf(outputs, candidates.map((c) => c.id));
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SIDE_BY_SIDE_MAX_INPUTS);
  const omitted = rows.length - shown.length;
  return (
    <Section
      title="Outputs side by side"
      hint={`Every candidate's answer to the same input, first trial, exactly the text the judge saw.${omitted > 0 ? ` The first ${shown.length} inputs are here; the other ${omitted} are under Raw candidate outputs.` : ""}`}
    >
      {shown.length === 1 ? (
        <Row row={shown[0]} />
      ) : (
        shown.map((row, i) => (
          <Fold key={row.input} title={row.input} count={`${row.cells.filter((c) => c.output?.text != null).length} outputs`} defaultOpen={open && i === 0}>
            <Row row={row} />
          </Fold>
        ))
      )}
    </Section>
  );
}
