/**
 * What the judge thought, through two lenses: the 1–5 score each output got
 * on its own (how big the gap is), and who was preferred head to head (which
 * way it points). Both can be true at once — a candidate can lose every duel
 * narrowly and still score 4.0 against 5.0.
 */

import type { StepReport } from "../../../../../report-model.js";
import { Radar } from "../charts/Radar";
import { TrialStrip } from "../charts/TrialStrip";
import { Heatmap } from "../charts/Heatmap";
import { Preference } from "../charts/Preference";
import { Code, Note, Section } from "../Section";

type Props = Pick<StepReport, "absoluteRan" | "saturated" | "dims" | "profiles" | "preference" | "trials"> & {
  colorOf: Map<string, number>;
};

export function Profile({ absoluteRan, saturated, dims, profiles, preference, trials, colorOf }: Props) {
  if (!absoluteRan && preference === null) return null;
  return (
    <Section
      title="Judge scores"
      hint={absoluteRan ? "Absolute scores show how large the gaps are; pairwise win rate shows who the judge prefers. Both are for reference only and do not affect the recommendation." : "This step declared no absolute scoring, only pairwise comparison."}
    >
      {absoluteRan && saturated.length > 0 && (
        <p className="bg-muted/60 px-3 py-2 text-sm">
          On {saturated.map((d, i) => <span key={d}>{i > 0 && ", "}<Code>{d}</Code></span>)}, every candidate got the same score -
           the scorer did not tell them apart, so these scores say nothing about which is better.
        </p>
      )}
      {!absoluteRan && (
        <Note>
          The spec's <Code>methods</Code> does not include <Code>absolute-1-5</Code>, so there are no absolute scores. That was declared, not missed.
        </Note>
      )}
      {absoluteRan && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Radar dims={dims} profiles={profiles} saturated={saturated} colorOf={colorOf} />
            <TrialStrip trials={trials} colorOf={colorOf} />
          </div>
          <Heatmap dims={dims} profiles={profiles} saturated={saturated} />
        </>
      )}
      <Preference table={preference} />
      <Note>
        A pairwise win rate counts only the comparisons that candidate took part in. <Code>0</Code> means "lost every duel", not that the output was bad.
      </Note>
    </Section>
  );
}
