/**
 * One mark per trial, not an average. With two or three repeats an average
 * hides the thing that matters most — whether the candidate is consistent —
 * and a mean over a timeout is a lie.
 */

import type { TrialRow } from "../../../../../canon/rows.js";
import { seriesColor } from "../tone";
import { TICKS, scale } from "./geometry";

const W = 560;
const ROW_H = 38;
const LEFT = 132;
const PLOT = W - LEFT - 28;

interface Props {
  trials: TrialRow[];
  colorOf: Map<string, number>;
}

function Row({ candidate, trials, index, color }: { candidate: string; trials: TrialRow[]; index: number; color: string }) {
  const cy = 30 + index * ROW_H;
  // Two trials with the same score would sit on top of each other; nudge
  // them apart so the eye counts the right number of runs.
  const seen = new Map<number, number>();
  return (
    <g>
      <text x={LEFT - 10} y={cy + 4} textAnchor="end" className="fill-foreground font-mono text-[11px]">{candidate}</text>
      {trials.map((t) => {
        const score = t.judge?.absolute_overall;
        const state = `${t.completion_state}${t.truncated ? " · 截断" : ""}`;
        if (typeof score !== "number") {
          return (
            <text key={t.trial} x={LEFT + 6} y={cy + 4} className="fill-muted-foreground text-[11px]">
              {state}，没有打分
            </text>
          );
        }
        const stack = seen.get(score) ?? 0;
        seen.set(score, stack + 1);
        const dy = stack === 0 ? 0 : stack % 2 === 1 ? 7 : -7;
        const bad = t.completion_state !== "success" || t.truncated;
        return (
          <circle
            key={t.trial}
            cx={LEFT + scale(score, PLOT)}
            cy={cy + dy}
            r={6}
            fill={bad ? "var(--card)" : color}
            stroke={bad ? color : "var(--card)"}
            strokeWidth={2}
            strokeDasharray={bad ? "3 2" : undefined}
          >
            <title>{`${candidate} · t${t.trial} · ${state} · ${score}/5`}</title>
          </circle>
        );
      })}
    </g>
  );
}

export function TrialStrip({ trials, colorOf }: Props) {
  if (trials.length === 0) return null;
  const order = [...new Set(trials.map((t) => t.candidate))];
  const height = order.length * ROW_H + 28;

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="text-sm font-medium">
        每次试验的得分{" "}
        <span className="text-xs font-normal text-muted-foreground">一个点是一次试验，空心点表示没有正常完成</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label="每个候选每次试验的绝对总分">
        {TICKS.map((v) => (
          <g key={v}>
            <line x1={LEFT + scale(v, PLOT)} y1={18} x2={LEFT + scale(v, PLOT)} y2={order.length * ROW_H + 16} stroke="var(--border)" />
            <text x={LEFT + scale(v, PLOT)} y={12} textAnchor="middle" className="fill-muted-foreground text-[10px]">{v}</text>
          </g>
        ))}
        {order.map((candidate, i) => (
          <Row
            key={candidate}
            candidate={candidate}
            index={i}
            trials={trials.filter((t) => t.candidate === candidate)}
            color={seriesColor(colorOf.get(candidate))}
          />
        ))}
      </svg>
    </figure>
  );
}
