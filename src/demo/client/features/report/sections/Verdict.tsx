/**
 * The answer first. It names the RECOMMENDATION — eligibility gates, then
 * the declared operating mode — never the judge's favourite. The judge's pick
 * is stated underneath, apart, because the two can disagree and that
 * disagreement is information.
 */

import type { StepReport } from "../../../../../report-model.js";
import { fmtUsd } from "../../../../../report-format.js";
import { cn } from "@/lib/utils";
import { firmnessTone } from "@/lib/tone";
import { Stat, Tag } from "../Section";

/** The left edge says how firm the answer is before a word is read. */
const EDGE: Record<string, string> = {
  ok: "border-l-ok",
  warn: "border-l-warn",
  bad: "border-l-bad",
};

function Line({ label, children }: { label: string; children: string }) {
  return (
    <p className="grid grid-cols-[4.5rem_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span>{children}</span>
    </p>
  );
}

type Props = Pick<StepReport, "verdict" | "eligible"> & { total: number };

export function Verdict({ verdict: v, eligible, total }: Props) {
  const h = v.headline;
  const tone = firmnessTone(v.firmness);
  return (
    <section
      aria-label="结论"
      className={cn("flex flex-col gap-4 border border-l-4 border-border bg-card p-5 shadow-sm", EDGE[tone])}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={tone} className="tracking-wider">{v.firmnessLabel}</Tag>
        <Tag tone="neutral">运行模式：{v.modeLabel}</Tag>
      </div>

      <div className="flex flex-col gap-1.5">
        <h2 className="text-xl font-semibold">
          {v.chosen ? <>推荐 <span className="font-mono font-bold text-brand">{v.chosen}</span></> : "没有可推荐的候选"}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">{v.text}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {h ? (
          <>
            <Stat label="每次成功的生成成本" value={fmtUsd(h.costPerSuccess)} />
            <Stat
              label="必过检查"
              value={h.checkExecuted > 0 ? `${h.checkPass} / ${h.checkExecuted}` : "—"}
              hint={h.checkExecuted > 0 ? "通过 / 实际执行" : "没有执行过"}
            />
          </>
        ) : (
          <Stat label="通过全部门槛" value={`${eligible.length} / ${total}`} hint="个候选" />
        )}
        <Stat label="本次评测总花费" value={fmtUsd(v.spend)} hint="含生成、裁判、打分" />
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <Line label="确信度">{v.firmnessNote}</Line>
        <Line label="裁判意见">{v.judgeNote}</Line>
      </div>
    </section>
  );
}
