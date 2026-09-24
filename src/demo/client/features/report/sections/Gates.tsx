/**
 * How the field narrowed: each gate in order, who it removed and on what
 * number, then how the survivors were ranked. Read top to bottom, it is the
 * whole argument for the recommendation.
 */

import type { StepReport } from "../../../../../report-model.js";
import { Section } from "../Section";

type Props = Pick<StepReport, "gates" | "eligible"> & { chosen: string | null; modeLabel: string };

export function Gates({ gates, eligible, chosen, modeLabel }: Props) {
  return (
    <Section title="筛选过程" hint="逐道门槛淘汰，剩下的候选再按运行模式排序。">
      <ol className="flex flex-col">
        {gates.map((g, i) => (
          <li key={i} className="relative ml-2.5 border-l border-border pb-4 pl-6 last:border-transparent last:pb-0">
            <span className="absolute -left-2.5 top-0 flex size-5 items-center justify-center rounded-full border border-brand/40 bg-brand-soft text-[11px] font-semibold text-brand">
              {i + 1}
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{g.label}</p>
              {g.removed.length === 0 ? (
                <p className="text-sm text-ok">全部通过</p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-sm">
                  {g.removed.map((r) => (
                    <li key={r.candidate}>
                      <span className="font-medium text-bad">淘汰</span>{" "}
                      <span className="font-mono">{r.candidate}</span>
                      <span className="text-muted-foreground"> · {r.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
      <p className="border-l-2 border-brand bg-brand-soft px-3 py-2 text-sm">
        {eligible.length === 0 ? (
          "没有候选通过全部门槛。"
        ) : (
          <>
            剩下 <span className="font-mono">{eligible.join("、")}</span>
            {chosen ? <> → 按「{modeLabel}」选出 <b className="font-mono">{chosen}</b></> : <>，但按「{modeLabel}」没能选出推荐</>}
          </>
        )}
      </p>
    </Section>
  );
}
