/**
 * What the required check leads with (canon/headline.ts, canon/parts.ts):
 * the caveats to read the numbers with, a column per headline number with
 * its count and 95% interval, whether any two candidates differ, the pass
 * rate per part tag, and every part across the candidates.
 */

import type { StepReport } from "../../../../../report-model.js";
import type { HeadlineDifference, HeadlineEntry, HeadlineValue } from "../../../../../canon/headline.js";
import { Note, Section } from "../Section";

type Props = Pick<StepReport, "headline" | "caveats" | "parts"> & { candidates: string[] };

const pct = (v: number): string => `${Math.round(v * 100)}%`;
const num = (v: number): string => v.toFixed(2);
const fmtP = (p: number): string => (p < 0.001 ? "< 0.001" : p.toFixed(3));

function Value({ v }: { v: HeadlineValue | null | undefined }) {
  if (!v) return <span className="text-muted-foreground">—</span>;
  const fmt = v.kind === "share" ? pct : num;
  return (
    <>
      <span className="tabular-nums">
        {v.kind === "share" ? `${v.numerator}/${v.denominator} · ` : ""}
        <b>{fmt(v.value)}</b>
      </span>
      <span className="block text-xs text-muted-foreground tabular-nums">
        {v.low !== null && v.high !== null ? `95% ${fmt(v.low)}–${fmt(v.high)} · ` : ""}n {v.inputs}
      </span>
    </>
  );
}

const pairText = (d: HeadlineDifference): string => `${d.a} higher on ${d.a_better}, ${d.b} on ${d.b_better}, equal on ${d.same} (p ${fmtP(d.p_value)})`;

function difference(h: HeadlineEntry): string | null {
  const pairs = h.differences.filter((d) => d.compared > 0);
  if (pairs.length === 0) return null;
  const firm = pairs.filter((d) => d.significant);
  if (firm.length > 0) return `${h.decl.label}: ${firm.map(pairText).join("; ")}.`;
  const closest = pairs.reduce((best, d) => (d.p_value < best.p_value ? d : best));
  return `${h.decl.label}: no difference shown. Closest: ${pairText(closest)}.`;
}

const TH = "py-1.5 pr-4 font-medium";
const TD = "py-1.5 pr-4 align-top";

function partTone(pass: number, graded: number): string {
  if (graded === 0) return "text-muted-foreground";
  return pass === graded ? "text-ok" : pass === 0 ? "text-bad" : "";
}

export function Headline({ headline, caveats, parts, candidates }: Props) {
  if (headline.length === 0 && caveats.length === 0 && !parts) return null;
  const differences = headline.map(difference).filter((d): d is string => d !== null);
  return (
    <>
      {caveats.length > 0 && (
        <Section title="Read these numbers with care">
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </Section>
      )}
      {headline.length > 0 && (
        <Section title="Headline numbers" hint="What the required check leads with, per candidate. A share is counted over graded trials; n is the inputs it is over.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className={TH}>Candidate</th>
                  {headline.map((h) => <th key={h.decl.label} className={TH}>{h.decl.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c} className="border-b last:border-0">
                    <td className={`${TD} font-mono`}>{c}</td>
                    {headline.map((h) => <td key={h.decl.label} className={TD}><Value v={h.all[c]} /></td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {differences.length > 0 && (
            <ul className="list-disc pl-5 text-sm">
              {differences.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
          {differences.length > 0 && <Note>Each pair is compared input by input with an exact two-sided sign test at 0.05, not adjusted for the number of pairs. No difference shown is not evidence of none.</Note>}
        </Section>
      )}
      {parts && (
        <Section title={parts.title} hint="Each one across candidates: passes / graded trials. Per tag, a part is counted under its own tags only; n is the parts.">
          {parts.groups.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className={TH}>Tag</th>
                    <th className={TH}>Parts</th>
                    {candidates.map((c) => <th key={c} className={`${TH} font-mono`}>{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {parts.groups.flatMap((g) => [
                    ...(g.title ? [<tr key={`g-${g.title}`} className="border-b bg-muted/40"><td colSpan={candidates.length + 2} className="py-1 pr-4 text-xs font-medium uppercase text-muted-foreground">{g.title}</td></tr>] : []),
                    ...g.rows.map((r) => (
                      <tr key={`${g.title}-${r.label}`} className="border-b last:border-0">
                        <td className={`${TD} font-mono`}>{r.label}</td>
                        <td className={`${TD} tabular-nums`}>{r.parts}</td>
                        {candidates.map((c) => <td key={c} className={TD}><Value v={r.cells[c]} /></td>)}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className={TH}>Input</th>
                  <th className={TH}>Part</th>
                  {candidates.map((c) => <th key={c} className={`${TH} font-mono`}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {parts.rows.map((r) => (
                  <tr key={`${r.input}-${r.id}`} className="border-b last:border-0">
                    <td className={`${TD} font-mono`}>{r.input}</td>
                    <td className={TD}>
                      {r.label ?? r.id}
                      {r.tags.length > 0 && <span className="block text-xs text-muted-foreground">{r.tags.join(" · ")}</span>}
                    </td>
                    {candidates.map((c) => {
                      const cell = r.cells[c] ?? { pass: 0, graded: 0 };
                      return <td key={c} className={`${TD} tabular-nums ${partTone(cell.pass, cell.graded)}`}>{cell.graded === 0 ? "—" : `${cell.pass}/${cell.graded}`}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
