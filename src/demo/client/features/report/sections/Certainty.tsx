/**
 * How sure the recommendation is: the chosen candidate's gated rates with
 * their 95% intervals, the per-input contest with the runner-up, and how much
 * of the input set carried any evidence.
 */

import { clearsGate, fmtP } from "../../../../../canon/stats.js";
import type { Certainty as CertaintyData } from "../../../../../report-model.js";
import { Section } from "../Section";

const MAX_LISTED = 12;

type Props = { certainty: CertaintyData };

export function Certainty({ certainty: c }: Props) {
  const gates = c.evidence?.gates ?? [];
  const versus = c.evidence?.versus_runner_up ?? null;
  if (gates.length === 0 && versus === null && c.inputs === 0) return null;
  const listed = c.allFail.slice(0, MAX_LISTED).join(", ") + (c.allFail.length > MAX_LISTED ? " …" : "");

  return (
    <Section title="How sure" hint="Wilson 95% intervals counted per input; exact sign test over inputs.">
      {gates.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-1.5 pr-4 font-medium">Gate (<span className="font-mono">{c.chosen}</span>)</th>
                <th className="py-1.5 pr-4 font-medium">Passed / inputs</th>
                <th className="py-1.5 pr-4 font-medium">95% interval</th>
                <th className="py-1.5 pr-4 font-medium">Gate</th>
                <th className="py-1.5 pr-4 font-medium">At the low end</th>
              </tr>
            </thead>
            <tbody>
              {gates.map((g) => {
                const holds = clearsGate(g.low, g.threshold);
                return (
                  <tr key={g.gate} className="border-b last:border-0">
                    <td className="py-1.5 pr-4">{g.gate}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{g.successes}/{g.n}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{g.low.toFixed(3)}–{g.high.toFixed(3)}</td>
                    <td className="py-1.5 pr-4 tabular-nums">{g.threshold}</td>
                    <td className={`py-1.5 pr-4 ${holds ? "text-ok" : "text-bad"}`}>{holds ? "holds" : "not shown"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {versus && (
        <p className="text-sm text-muted-foreground">
          Against the runner-up, input by input: <span className="font-mono">{versus.a}</span> did better on {versus.a_better},{" "}
          <span className="font-mono">{versus.b}</span> on {versus.b_better}, equal on {versus.same} (exact sign test p {fmtP(versus.p_value)}
          {versus.significant ? "" : ", not significant"}).
        </p>
      )}
      {c.inputs > 0 && (
        <p className="text-sm text-muted-foreground">
          <b className="text-foreground">Effective N {c.effectiveN} of {c.inputs}.</b> Inputs that separated any two candidates;{" "}
          {c.allPass} every candidate passed and {c.flat} gave everyone the same partial rate, so they cannot inform a choice.
          {c.allFail.length > 0 && <> Every candidate failed {c.allFail.length}: <span className="font-mono">{listed}</span> — check those for a harness or check bug first.</>}
        </p>
      )}
    </Section>
  );
}
