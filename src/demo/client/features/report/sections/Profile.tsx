/**
 * What the judge said, in plain terms: the share of each candidate's trials at
 * each 1–5 score, beside the required check, and — only when pairwise judging
 * ran — who it preferred head to head. Neither feeds the recommendation.
 */

import type { CandidateRow, StepReport } from "../../../../../report-model.js";
import { Distribution } from "../charts/Distribution";
import { ScoreSummary } from "../charts/ScoreSummary";
import { Preference } from "../charts/Preference";
import { Code, Note, Section } from "../Section";

type Props = Pick<StepReport, "absoluteRan" | "distribution" | "scoreSummary" | "preference"> & {
  candidates: CandidateRow[];
};

export function Profile({ absoluteRan, distribution, scoreSummary, preference, candidates }: Props) {
  if (!absoluteRan && preference === null) return null;
  const checks = new Map(candidates.map((c) => [c.id, { pass: c.checkPass, executed: c.checkExecuted }]));
  const kinds = [absoluteRan ? "1–5 per trial" : null, preference ? "pairwise win rate" : null].filter(Boolean).join(" · ");
  return (
    <Section title="Judge scores" hint={`${kinds} · not used by the recommendation`}>
      {absoluteRan ? (
        <Note>
          The judge read the free-text part of each answer against the rubric and gave it 1–5. Each bar is one candidate: how many of its trials got each score, red (1) to blue (5). Rows are ordered by <b>required check</b>, most answers right first.
          Read it beside <b>required check</b>, which says whether the answer itself was right: a well-written note on a wrong answer still scores high here.
        </Note>
      ) : (
        <Note>
          No 1–5 scores: this step's <Code>methods</Code> does not declare <Code>absolute-1-5</Code>. That was declared, not missed.
        </Note>
      )}
      {absoluteRan && <ScoreSummary blocks={distribution} rows={scoreSummary} checks={checks} />}
      {absoluteRan && <Distribution blocks={distribution} checks={checks} />}
      <Preference table={preference} />
      {preference && (
        <Note>
          Pairwise win rate is a separate question: shown two outputs side by side, which did the judge prefer, 0–100, a tie counting 0.5. It only counts the matches each candidate
          took part in, so <Code>0</Code> means "lost every match", not "bad output".
        </Note>
      )}
    </Section>
  );
}
