/**
 * Results by input tag: the required check's pass count per candidate for
 * each tag and split the task gave its inputs. Where the overall pass rate
 * hides that a candidate fails one kind of case, this table shows it.
 */

import type { StepReport } from "../../../../../report-model.js";
import { Section } from "../Section";

type Props = Pick<StepReport, "slices"> & { candidates: string[] };

function tone(pass: number, graded: number): string {
  if (graded === 0) return "text-muted-foreground";
  if (pass === graded) return "text-ok";
  return pass / graded >= 0.5 ? "" : "text-bad";
}

export function Slices({ slices, candidates }: Props) {
  if (slices.length === 0) return null;
  return (
    <Section title="Results by input tag" hint="Required-check passes / graded trials, for the inputs carrying each tag or in each split.">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-1.5 pr-4 font-medium">Tag</th>
              <th className="py-1.5 pr-4 font-medium">Inputs</th>
              {candidates.map((c) => (
                <th key={c} className="py-1.5 pr-4 font-mono font-medium">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.label} className="border-b last:border-0">
                <td className="py-1.5 pr-4 font-mono">{s.label}</td>
                <td className="py-1.5 pr-4 tabular-nums">{s.inputs}</td>
                {candidates.map((c) => {
                  const cell = s.cells[c] ?? { pass: 0, graded: 0 };
                  return (
                    <td key={c} className={`py-1.5 pr-4 tabular-nums ${tone(cell.pass, cell.graded)}`}>
                      {cell.graded === 0 ? "—" : `${cell.pass}/${cell.graded}`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
