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
      title="裁判评分"
      hint={absoluteRan ? "绝对分看差距有多大，成对胜率看谁更受偏好。两者都只作参考，不参与推荐。" : "这一步没有声明绝对打分，只有成对比较。"}
    >
      {absoluteRan && saturated.length > 0 && (
        <p className="bg-muted/60 px-3 py-2 text-sm">
          在 {saturated.map((d, i) => <span key={d}>{i > 0 && "、"}<Code>{d}</Code></span>)} 上，所有候选拿到了同一个分——
          打分器没有分出差异，这些分数不能说明谁更好。
        </p>
      )}
      {!absoluteRan && (
        <Note>
          规格的 <Code>methods</Code> 里没有 <Code>absolute-1-5</Code>，所以没有绝对分。这是声明的结果，不是漏跑。
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
        成对胜率的分母只有该候选参加过的比较。<Code>0</Code> 表示「每场都输」，不代表输出很差。
      </Note>
    </Section>
  );
}
